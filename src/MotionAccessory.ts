import {
    PlatformAccessory,
    Logger, API, Service, Nullable, CharacteristicValue
} from 'homebridge';
import {Platform} from './Platform';
import {Camera} from "./sdm/Camera";
import {Accessory} from "./Accessory";

export abstract class MotionAccessory<T extends Camera> extends Accessory<T> {
    private readonly motionService: Service;
    private lastMotion: number | undefined;

    constructor(
        api: API,
        log: Logger,
        platform: Platform,
        accessory: PlatformAccessory,
        device: T) {
        super(api, log, platform, accessory, device);

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
