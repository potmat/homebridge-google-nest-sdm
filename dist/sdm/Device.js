"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Device = void 0;
const lodash_1 = __importDefault(require("lodash"));
class Device {
    constructor(smartdevicemanagement, device, log) {
        this.smartdevicemanagement = smartdevicemanagement;
        this.device = device;
        this.lastRefresh = Date.now();
        const parent = lodash_1.default.find(device.parentRelations, relation => relation.displayName);
        this.displayName = parent === null || parent === void 0 ? void 0 : parent.displayName;
        this.log = log;
    }
    event(event) {
        if (event.resourceUpdate && event.resourceUpdate.traits) {
            const traitEvent = event;
            lodash_1.default.forEach(traitEvent.resourceUpdate.traits, (value, key) => {
                if (this.device.traits && this.device.traits[key])
                    this.device.traits[key] = value;
            });
        }
    }
    ;
    /**
     * The user-assigned device name from the Info trait, or null when unset.
     * Renames in the Google Home app land HERE (Info.customName) — the
     * parentRelations displayName is the ROOM relation and does not change on
     * a device rename. Reading it live from traits means SDM Info events and
     * the daily refresh pick renames up without a plugin restart.
     */
    getCustomName() {
        var _a, _b;
        const info = ((_a = this.device) === null || _a === void 0 ? void 0 : _a.traits) ? this.device.traits['sdm.devices.traits.Info'] : undefined;
        const name = (_b = info === null || info === void 0 ? void 0 : info.customName) === null || _b === void 0 ? void 0 : _b.trim();
        return name ? name : null;
    }
    /**
     * Display name for an accessory: the Google Home custom name if the user set
     * one, otherwise the room relation plus a device-type suffix (e.g. "Office
     * Camera"), or "Unknown" when neither is known. Shared so every device type
     * resolves names the same way.
     */
    resolveDisplayName(typeSuffix) {
        var _a;
        return (_a = this.getCustomName()) !== null && _a !== void 0 ? _a : (this.displayName ? `${this.displayName} ${typeSuffix}` : 'Unknown');
    }
    getName() {
        return this.device.name;
    }
    async refresh() {
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.get({ name: this.getName() });
            this.log.debug(`Request for device info for ${this.getDisplayName()} had value ${JSON.stringify(response.data)}`);
            this.device = response.data;
            this.lastRefresh = Date.now();
        }
        catch (error) {
            this.log.error('Could not execute device GET request: ', JSON.stringify(error), this.getDisplayName());
        }
    }
    async getTrait(name) {
        var _a, _b;
        const howLongAgo = Date.now() - this.lastRefresh;
        //Events will update traits as necessary
        //no need to refresh more than once per day
        if (howLongAgo > 1000 * 60 * 60 * 24) {
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