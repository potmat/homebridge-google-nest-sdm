import * as google from "googleapis";
import * as Timers from "node:timers/promises";
import * as Events from './Events';
import {Logger} from "homebridge";
import _ from "lodash";

export abstract class Device {
    protected smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement;
    protected device: google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1Device;
    protected lastRefresh: number;
    protected displayName: string|null|undefined;
    protected log: Logger;
    protected idempotentCommands = new Map<string, IdempotentCommand<unknown>>();
    constructor(smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement,
                device: google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1Device,
                log: Logger) {
        this.smartdevicemanagement = smartdevicemanagement;
        this.device = device;
        this.lastRefresh = Date.now();
        const parent = <google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1ParentRelation|undefined>_.find(device.parentRelations, relation => relation.displayName);
        this.displayName = parent?.displayName;
        this.log = log;
    }

    event(event: Events.Event): void {
        if ((event as any).resourceUpdate && (event as any).resourceUpdate.traits) {
            const traitEvent = event as Events.ResourceTraitEvent;
            _.forEach(traitEvent.resourceUpdate.traits, (value, key) => {
                if (this.device.traits && this.device.traits[key])
                    this.device.traits[key] = value;
            })
        }
    };

    abstract getDisplayName() : string;

    getName(): string {
        return <string>this.device.name;
    }

    async refresh() {
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.get({name: this.getName()});
            this.log.debug(`Request for device info for ${this.getDisplayName()} had value ${JSON.stringify(response.data)}`);
            this.device = response.data;
            this.lastRefresh = Date.now();
        } catch (error: any) {
            this.log.error('Could not execute device GET request: ', JSON.stringify(error), this.getDisplayName());
        }
    }

    async getTrait<T>(name: string): Promise<T | null> {
        const howLongAgo: number = Date.now() - this.lastRefresh;
        //Events will update traits as necessary
        //no need to refresh more than once per day
        if (howLongAgo > 1000 * 60 * 60 * 24) {
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
            this.log.info(`Execution of command ${name} returned ${JSON.stringify(response.data.results)}`, this.getDisplayName());
            return <U>response.data.results;
        } catch (error: any) {
            this.log.error('Could not execute device command: ', JSON.stringify(error), this.getDisplayName());
        }

        return undefined;
    }

    executeIdempotentCommand<T, U>(name: string, params?: T): void {
        let command = this.idempotentCommands.get(name);
        if (!command) {
            command = new IdempotentCommand();
            this.idempotentCommands.set(name, command);
        }
        command.execute(() => this.executeCommand(name, params));

    }
}

class IdempotentCommand<Type> {
    private operation?: (() => Promise<Type>) | undefined;
    private result?: Promise<Type>;
    private timer?: Promise<void>;

    execute(operation: () => Promise<Type>): void {
        this.operation = operation;
        this.timer = Timers.setTimeout(500);
        const result = (async () => {
            let timer;
            while (timer !== this.timer) {
                timer = this.timer;
                await timer;
            }
            const nextOperation = this.operation;
            if (nextOperation) {
                this.operation = undefined;
                this.result = nextOperation();
            }
            return this.result;
        })();
        // Return immediately. Make sure to catch potential promises which would otherwise halt the
        // service.
        result.catch(() => {});
    }
}
