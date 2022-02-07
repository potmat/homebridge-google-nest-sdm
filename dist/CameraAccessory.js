"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CameraAccessory = void 0;
const CameraStreamingDelegate_1 = require("./CameraStreamingDelegate");
const MotionAccessory_1 = require("./MotionAccessory");
class CameraAccessory extends MotionAccessory_1.MotionAccessory {
    constructor(api, log, platform, accessory, device) {
        super(api, log, platform, accessory, device);
        this.accessory.on("identify" /* IDENTIFY */, () => {
            this.log.info("%s identified!", this.accessory.displayName);
        });
        //create a new Motion service
        this.cameraRecordingManagement = accessory.getService(this.api.hap.Service.CameraRecordingManagement);
        if (!this.cameraRecordingManagement) {
            this.cameraRecordingManagement = accessory.addService(this.api.hap.Service.CameraRecordingManagement);
        }
        this.streamingDelegate = new CameraStreamingDelegate_1.CameraStreamingDelegate(log, api, this.platform, this.device, this.accessory);
        this.accessory.configureController(this.streamingDelegate.getController());
        this.cameraRecordingManagement.getCharacteristic(this.platform.Characteristic.Active)
            .onSet((active) => this.streamingDelegate.updateRecordingActive(!!active));
        this.cameraRecordingManagement.getCharacteristic(this.platform.Characteristic.SupportedCameraRecordingConfiguration)
            .onSet((supportedCameraRecordingConfiguration) => this.streamingDelegate.updateRecordingConfiguration(supportedCameraRecordingConfiguration));
    }
}
exports.CameraAccessory = CameraAccessory;
//# sourceMappingURL=CameraAccessory.js.map