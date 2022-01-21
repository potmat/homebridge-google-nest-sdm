"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Accessory = void 0;
class Accessory {
    constructor(api, log, platform, accessory, device) {
        this.platform = platform;
        this.log = log;
        this.api = api;
        this.accessory = accessory;
        this.device = device;
        new this.api.hap.Service.AccessoryInformation()
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest');
    }
    async convertToNullable(input) {
        const result = await input;
        if (!result)
            return null;
        return result;
    }
}
exports.Accessory = Accessory;
//# sourceMappingURL=Accessory.js.map