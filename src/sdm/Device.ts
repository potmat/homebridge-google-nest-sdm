import * as google from "googleapis";
import * as Events from './Events';
import {Logger} from "homebridge";
import _ from "lodash";

export abstract class Device {
    protected smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement;
    protected device: google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1Device;
    protected lastRefresh: number;
    protected displayName: string|null|undefined;
    protected log: Logger;
    private traitTimes = new Map<string, number>();
    private traitVersions = new Map<string, number>();
    private snapshotTime: number;
    private refreshPromise?: Promise<void>;
    private stopped = false;
    constructor(smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement,
                device: google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1Device,
                log: Logger) {
        this.smartdevicemanagement = smartdevicemanagement;
        this.device = device;
        this.lastRefresh = Date.now();
        this.snapshotTime = this.lastRefresh;
        const parent = <google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1ParentRelation|undefined>_.find(device.parentRelations, relation => relation.displayName);
        this.displayName = parent?.displayName;
        this.log = log;
    }

    /** Filter trait updates before subclass callbacks, not just cache writes. */
    receiveEvent(event: Events.Event): void {
        if (this.stopped) return;
        const update = (event as Events.ResourceTraitEvent).resourceUpdate;
        if (!update?.traits) {
            this.event(event); // Camera/doorbell events are not trait snapshots.
            return;
        }
        const timestamp = Date.parse(event.timestamp);
        if (!Number.isFinite(timestamp)) return;
        const traits: {[key: string]: any} = {};
        for (const [key, value] of Object.entries(update.traits)) {
            if (timestamp <= Math.max(this.snapshotTime, this.traitTimes.get(key) ?? 0)) continue;
            this.traitTimes.set(key, timestamp);
            this.traitVersions.set(key, (this.traitVersions.get(key) ?? 0) + 1);
            traits[key] = value;
        }
        if (Object.keys(traits).length) {
            this.event({...event, resourceUpdate: {...update, traits}} as Events.ResourceTraitEvent);
        }
    }

    close() { this.stopped = true; }

    event(event: Events.Event): void {
        if ((event as any).resourceUpdate && (event as any).resourceUpdate.traits) {
            const traitEvent = event as Events.ResourceTraitEvent;
            _.forEach(traitEvent.resourceUpdate.traits, (value, key) => {
                if (this.device.traits)
                    this.device.traits[key] = value;
            })
        }
    };

    abstract getDisplayName() : string;

    getName(): string {
        return <string>this.device.name;
    }

    refresh(): Promise<void> {
        if (this.stopped) return Promise.resolve();
        if (!this.refreshPromise) {
            this.refreshPromise = this.fetchSnapshot().finally(() => { this.refreshPromise = undefined; });
        }
        return this.refreshPromise;
    }

    private async fetchSnapshot() {
        const started = Date.now();
        const versions = new Map(this.traitVersions);
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.get(
                {name: this.getName()}, {timeout: 30000});
            if (this.stopped) return;
            const traits: {[key: string]: any} = {};
            for (const [key, value] of Object.entries(response.data.traits ?? {})) {
                // Preserve events received during this GET, including delayed ones.
                if (versions.get(key) !== this.traitVersions.get(key) ||
                    (this.traitTimes.get(key) ?? 0) > started) continue;
                if (!_.isEqual(this.device.traits?.[key], value)) traits[key] = value;
            }
            this.snapshotTime = Math.max(this.snapshotTime, started);
            this.lastRefresh = Date.now();
            if (Object.keys(traits).length) {
                this.event({timestamp: new Date(started).toISOString(),
                    resourceUpdate: {name: this.getName(), traits}} as Events.ResourceTraitEvent);
            }
        } catch (error: any) {
            this.log.error('Could not refresh device:', error.message, this.getDisplayName());
        }
    }

    async getTrait<T>(name: string): Promise<T | null> {
        const howLongAgo: number = Date.now() - this.lastRefresh;
        // Events provide low latency; reconciliation repairs missed events.
        if (howLongAgo > 1000 * 60 * 5) {
            await this.refresh();
            this.log.debug(`Last refresh for ${this.getDisplayName()} was ${howLongAgo/1000}s, refreshing.`)
        }

        const value = this.device?.traits ? this.device?.traits[name] : null;
        //this.log.debug(`Request for trait ${name} had value ${JSON.stringify(value)}`, this.getDisplayName());
        return value;
    }

    async executeCommand<T, U>(name: string, params?: T): Promise<U | undefined> {
        this.log.debug(`Executing command ${name} with parameters ${JSON.stringify(params)}`, this.getDisplayName());
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.executeCommand({
                name: this.device?.name || undefined,
                requestBody: {
                    command: name,
                    params: params
                }
            });
            this.log.debug(`Execution of command ${name} returned ${JSON.stringify(response.data.results)}`, this.getDisplayName());
            return <U>response.data.results;
        } catch (error: any) {
            const serializedError = JSON.stringify(error) || '';
            const isRateLimited = error?.response?.status === 429
                || error?.code === 429
                || serializedError.includes('RESOURCE_EXHAUSTED')
                || serializedError.includes('Rate limited');

            if (isRateLimited) {
                this.log.error(`Google rate-limited the ${name} command (HTTP 429). Too many camera commands in a short period — wait about a minute before retrying.`, this.getDisplayName());
            } else {
                this.log.error('Could not execute device command: ', JSON.stringify(error), this.getDisplayName());
            }
        }

        return undefined;
    }
}
