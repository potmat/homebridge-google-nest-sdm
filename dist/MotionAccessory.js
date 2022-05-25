"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MotionAccessory = void 0;
const Accessory_1 = require("./Accessory");
class MotionAccessory extends Accessory_1.Accessory {
    constructor(api, log, platform, accessory, device) {
        super(api, log, platform, accessory, device);
        this.motionDecay = 20000;
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
            if (!this.lastMotion || Date.now() - this.lastMotion > this.motionDecay) {
                this.lastMotion = undefined;
                this.motionService.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
            }
        }, this.motionDecay);
    }
    handleMotionDetectedGet() {
        return !!(this.lastMotion && Date.now() - this.lastMotion <= this.motionDecay);
    }
}
exports.MotionAccessory = MotionAccessory;
//# sourceMappingURL=MotionAccessory.js.map