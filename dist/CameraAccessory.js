"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CameraAccessory = void 0;
const Accessory_1 = require("./Accessory");
const CameraStreamingDelegate_1 = require("./CameraStreamingDelegate");
class CameraAccessory extends Accessory_1.Accessory {
    constructor(api, log, platform, accessory, device) {
        super(api, log, platform, accessory, device);
        this.accessory.on("identify" /* IDENTIFY */, () => {
            log.info("%s identified!", this.accessory.displayName);
        });
        const streamingDelegate = new CameraStreamingDelegate_1.CameraStreamingDelegate(log, api, this.platform.config.options, this.device);
        this.accessory.configureController(streamingDelegate.getController());
    }
}
exports.CameraAccessory = CameraAccessory;
//# sourceMappingURL=CameraAccessory.js.map