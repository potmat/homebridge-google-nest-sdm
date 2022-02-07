import {
    PlatformAccessory,
    PlatformAccessoryEvent,
    Logger, API, Service, CameraRecordingConfiguration
} from 'homebridge';
import {Platform} from './Platform';
import {Camera} from "./sdm/Camera";
import {CameraStreamingDelegate} from "./CameraStreamingDelegate";
import {MotionAccessory} from "./MotionAccessory";

export class CameraAccessory extends MotionAccessory<Camera> {
    // protected cameraRecordingManagement: Service;
    protected streamingDelegate: CameraStreamingDelegate;

    constructor(
        api: API,
        log: Logger,
        platform: Platform,
        accessory: PlatformAccessory,
        device: Camera) {
        super(api, log, platform, accessory, device);

        this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            this.log.info("%s identified!", this.accessory.displayName);
        });

        // this.cameraRecordingManagement = <Service>accessory.getService(this.api.hap.Service.CameraRecordingManagement);
        // if (!this.cameraRecordingManagement) {
        //     this.cameraRecordingManagement = accessory.addService(this.api.hap.Service.CameraRecordingManagement);
        // }

        this.streamingDelegate = new CameraStreamingDelegate(log, api, this.platform, this.device, this.accessory);
        this.accessory.configureController(this.streamingDelegate.getController());

        // this.cameraRecordingManagement.getCharacteristic(this.platform.Characteristic.Active)
        //     .onSet((active) => this.streamingDelegate.updateRecordingActive(!!active));
        //
        // this.cameraRecordingManagement.getCharacteristic(this.platform.Characteristic.SupportedCameraRecordingConfiguration)
        //     .onSet((supportedCameraRecordingConfiguration) => this.streamingDelegate.updateRecordingConfiguration(<CameraRecordingConfiguration>supportedCameraRecordingConfiguration))
    }
}
