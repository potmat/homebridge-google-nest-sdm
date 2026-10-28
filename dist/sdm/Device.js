"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Device = void 0;
const lodash_1 = __importDefault(require("lodash"));
class Device {
    constructor(smartdevicemanagement, device, log) {
        this.traitTimes = new Map();
        this.traitVersions = new Map();
        this.stopped = false;
        this.smartdevicemanagement = smartdevicemanagement;
        this.device = device;
        this.lastRefresh = Date.now();
        this.snapshotTime = this.lastRefresh;
        const parent = lodash_1.default.find(device.parentRelations, relation => relation.displayName);
        this.displayName = parent === null || parent === void 0 ? void 0 : parent.displayName;
        this.log = log;
    }
    /** Filter trait updates before subclass callbacks, not just cache writes. */
    receiveEvent(event) {
        var _a, _b;
        if (this.stopped)
            return;
        const update = event.resourceUpdate;
        if (!(update === null || update === void 0 ? void 0 : update.traits)) {
            this.event(event); // Camera/doorbell events are not trait snapshots.
            return;
        }
        const timestamp = Date.parse(event.timestamp);
        if (!Number.isFinite(timestamp))
            return;
        const traits = {};
        for (const [key, value] of Object.entries(update.traits)) {
            if (timestamp <= Math.max(this.snapshotTime, (_a = this.traitTimes.get(key)) !== null && _a !== void 0 ? _a : 0))
                continue;
            this.traitTimes.set(key, timestamp);
            this.traitVersions.set(key, ((_b = this.traitVersions.get(key)) !== null && _b !== void 0 ? _b : 0) + 1);
            traits[key] = value;
        }
        if (Object.keys(traits).length) {
            this.event({ ...event, resourceUpdate: { ...update, traits } });
        }
    }
    close() { this.stopped = true; }
    event(event) {
        if (event.resourceUpdate && event.resourceUpdate.traits) {
            const traitEvent = event;
            lodash_1.default.forEach(traitEvent.resourceUpdate.traits, (value, key) => {
                if (this.device.traits)
                    this.device.traits[key] = value;
            });
        }
    }
    ;
    getName() {
        return this.device.name;
    }
    refresh() {
        if (this.stopped)
            return Promise.resolve();
        if (!this.refreshPromise) {
            this.refreshPromise = this.fetchSnapshot().finally(() => { this.refreshPromise = undefined; });
        }
        return this.refreshPromise;
    }
    async fetchSnapshot() {
        var _a, _b, _c;
        const started = Date.now();
        const versions = new Map(this.traitVersions);
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.get({ name: this.getName() }, { timeout: 30000 });
            if (this.stopped)
                return;
            const traits = {};
            for (const [key, value] of Object.entries((_a = response.data.traits) !== null && _a !== void 0 ? _a : {})) {
                // Preserve events received during this GET, including delayed ones.
                if (versions.get(key) !== this.traitVersions.get(key) ||
                    ((_b = this.traitTimes.get(key)) !== null && _b !== void 0 ? _b : 0) > started)
                    continue;
                if (!lodash_1.default.isEqual((_c = this.device.traits) === null || _c === void 0 ? void 0 : _c[key], value))
                    traits[key] = value;
            }
            this.snapshotTime = Math.max(this.snapshotTime, started);
            this.lastRefresh = Date.now();
            if (Object.keys(traits).length) {
                this.event({ timestamp: new Date(started).toISOString(),
                    resourceUpdate: { name: this.getName(), traits } });
            }
        }
        catch (error) {
            this.log.error('Could not refresh device:', error.message, this.getDisplayName());
        }
    }
    async getTrait(name) {
        var _a, _b;
        const howLongAgo = Date.now() - this.lastRefresh;
        // Events provide low latency; reconciliation repairs missed events.
        if (howLongAgo > 1000 * 60 * 5) {
            await this.refresh();
            this.log.debug(`Last refresh for ${this.getDisplayName()} was ${howLongAgo / 1000}s, refreshing.`);
        }
        const value = ((_a = this.device) === null || _a === void 0 ? void 0 : _a.traits) ? (_b = this.device) === null || _b === void 0 ? void 0 : _b.traits[name] : null;
        //this.log.debug(`Request for trait ${name} had value ${JSON.stringify(value)}`, this.getDisplayName());
        return value;
    }
    async executeCommand(name, params) {
        var _a, _b;
        this.log.debug(`Executing command ${name} with parameters ${JSON.stringify(params)}`, this.getDisplayName());
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.executeCommand({
                name: ((_a = this.device) === null || _a === void 0 ? void 0 : _a.name) || undefined,
                requestBody: {
                    command: name,
                    params: params
                }
            });
            this.log.debug(`Execution of command ${name} returned ${JSON.stringify(response.data.results)}`, this.getDisplayName());
            return response.data.results;
        }
        catch (error) {
            const serializedError = JSON.stringify(error) || '';
            const isRateLimited = ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status) === 429
                || (error === null || error === void 0 ? void 0 : error.code) === 429
                || serializedError.includes('RESOURCE_EXHAUSTED')
                || serializedError.includes('Rate limited');
            if (isRateLimited) {
                this.log.error(`Google rate-limited the ${name} command (HTTP 429). Too many camera commands in a short period — wait about a minute before retrying.`, this.getDisplayName());
            }
            else {
                this.log.error('Could not execute device command: ', JSON.stringify(error), this.getDisplayName());
            }
        }
        return undefined;
    }
}
exports.Device = Device;
//# sourceMappingURL=Device.js.map