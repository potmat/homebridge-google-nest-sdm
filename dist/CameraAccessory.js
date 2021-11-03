"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CameraAccessory = void 0;
const StreamingDelegate_1 = require("./StreamingDelegate");
class CameraAccessory {
    constructor(api, log, platform, accessory) {
        this.api = api;
        this.log = log;
        this.platform = platform;
        this.accessory = accessory;
        this.hap = api.hap;
        this.camera = accessory.context.device;
        // set accessory information
        new this.hap.Service.AccessoryInformation()
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest');
        accessory.on("identify" /* IDENTIFY */, () => {
            log.info("%s identified!", accessory.displayName);
        });
        // if (this.camera instanceof Doorbell) {
        //     const doorbell = new this.hap.Service.Doorbell(this.camera.getDisplayName() + ' Doorbell');
        //     accessory.addService(doorbell);
        //     doorbell.
        // }
        const streamingDelegate = new StreamingDelegate_1.StreamingDelegate(log, api, this.platform.config.options, this.camera);
        accessory.configureController(streamingDelegate.controller);
    }
}
exports.CameraAccessory = CameraAccessory;
//# sourceMappingURL=CameraAccessory.js.map