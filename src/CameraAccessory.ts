import {
    PlatformAccessory,
    PlatformAccessoryEvent,
    Logger, API, Service, Nullable, CharacteristicValue
} from 'homebridge';
import {Platform} from './Platform';
import {Config} from "./Config";
import {Camera} from "./sdm/Camera";
import {Accessory} from "./Accessory";
import {CameraStreamingDelegate} from "./CameraStreamingDelegate";

export class CameraAccessory extends Accessory<Camera> {
    private readonly motionService: Service;
    private lastMotion: number | undefined;

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

        const streamingDelegate = new CameraStreamingDelegate(log, api, this.platform.config as unknown as Config, this.device);
        this.accessory.configureController(streamingDelegate.getController());
        //create a new Motion service
        this.motionService = <Service>accessory.getService(this.api.hap.Service.MotionSensor);
        if (!this.motionService) {
            this.motionService = accessory.addService(this.api.hap.Service.MotionSensor);
        }
        this.motionService.getCharacteristic(this.platform.Characteristic.MotionDetected)
            .onGet(this.handleMotionDetectedGet.bind(this));

        this.device.onMotion = this.handleMotion.bind(this);
    }

    private handleMotion() {
        this.log.debug('Motion detected!', this.accessory.displayName);
        this.lastMotion = Date.now();
        this.motionService.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
        setTimeout(() => {
            if (!this.lastMotion || Date.now() - this.lastMotion > 2000) {
                this.lastMotion = undefined;
                this.motionService.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
            }
        }, 2100)
    }

    private handleMotionDetectedGet(): Nullable<CharacteristicValue> {
        return !!(this.lastMotion && Date.now() - this.lastMotion <= 2000);
    }
}
