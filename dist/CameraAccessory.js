"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CameraAccessory = void 0;
const Accessory_1 = require("./Accessory");
const CameraStreamingDelegate_1 = require("./CameraStreamingDelegate");
class CameraAccessory extends Accessory_1.Accessory {
    constructor(api, log, platform, accessory, device) {
        super(api, log, platform, accessory, device);
        this.accessory.on("identify" /* IDENTIFY */, () => {
            this.log.info("%s identified!", this.accessory.displayName);
        });
        const streamingDelegate = new CameraStreamingDelegate_1.CameraStreamingDelegate(log, api, this.platform.config, this.device);
        this.accessory.configureController(streamingDelegate.getController());
        //create a new Motion service
        this.motionService = accessory.getService(this.api.hap.Service.MotionSensor);
        if (!this.motionService) {
            this.motionService = accessory.addService(this.api.hap.Service.MotionSensor);
        }
        this.motionService.getCharacteristic(this.platform.Characteristic.MotionDetected)
            .onGet(this.handleMotionDetectedGet.bind(this));
        this.device.onMotion = this.handleMotion.bind(this);
    }
    handleMotion() {
        this.log.debug('Motion detected!', this.accessory.displayName);
        this.lastMotion = Date.now();
        this.motionService.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
        setTimeout(() => {
            if (!this.lastMotion || Date.now() - this.lastMotion > 2000) {
                this.lastMotion = undefined;
                this.motionService.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
            }
        }, 2100);
    }
    handleMotionDetectedGet() {
        return !!(this.lastMotion && Date.now() - this.lastMotion <= 2000);
    }
}
exports.CameraAccessory = CameraAccessory;
//# sourceMappingURL=CameraAccessory.js.map