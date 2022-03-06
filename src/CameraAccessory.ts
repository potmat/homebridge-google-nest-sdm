import {
    PlatformAccessory,
    PlatformAccessoryEvent,
    Logger, API
} from 'homebridge';
import {Platform} from './Platform';
import {Camera} from "./sdm/Camera";
import {CameraStreamingDelegate} from "./CameraStreamingDelegate";
import {MotionAccessory} from "./MotionAccessory";

export class CameraAccessory extends MotionAccessory<Camera> {
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

        this.streamingDelegate = new CameraStreamingDelegate(log, api, this.platform, this.device, this.accessory);
        this.accessory.configureController(this.streamingDelegate.getController());
    }
}
