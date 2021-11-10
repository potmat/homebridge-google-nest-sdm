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
    getName() {
        return this.device.name;
    }
    async refresh() {
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.get({ name: this.getName() });
            this.device = response.data;
            this.lastRefresh = Date.now();
        }
        catch (e) {
            this.log.error('Could not execute API request.', e);
        }
    }
    async getTrait(name) {
        var _a, _b;
        const howLongAgo = Date.now() - this.lastRefresh;
        if (howLongAgo > 10000)
            await this.refresh();
        const value = ((_a = this.device) === null || _a === void 0 ? void 0 : _a.traits) ? (_b = this.device) === null || _b === void 0 ? void 0 : _b.traits[name] : undefined;
        this.log.debug(`Request for trait ${name} had value ${JSON.stringify(value)}`);
        return value;
    }
    async executeCommand(name, params) {
        var _a;
        this.log.debug(`Executing command ${name} with parameters ${JSON.stringify(params)}`);
        const response = await this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: ((_a = this.device) === null || _a === void 0 ? void 0 : _a.name) || undefined,
            requestBody: {
                command: name,
                params: params
            }
        });
        this.log.debug(`Execution of command ${name} returned ${JSON.stringify(response.data.results)}`);
        return response.data.results;
    }
}
exports.Device = Device;
//# sourceMappingURL=Device.js.map