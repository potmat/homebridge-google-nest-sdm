"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const StreamingDelegate_1 = require("./StreamingDelegate");
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
class CameraAccessory {
    constructor(api, log, platform, accessory) {
        this.api = api;
        this.log = log;
        this.platform = platform;
        this.accessory = accessory;
        this.hap = api.hap;
        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest');
        accessory.on("identify" /* IDENTIFY */, () => {
            log.info("%s identified!", accessory.displayName);
        });
        const streamingDelegate = new StreamingDelegate_1.StreamingDelegate(log, api, this.platform.config.options, accessory.context.device);
        accessory.configureController(streamingDelegate.controller);
    }
}
exports.CameraAccessory = CameraAccessory;
//# sourceMappingURL=CameraAccessory.js.map