import {
    PlatformAccessory,
    PlatformAccessoryEvent,
    HAP,
    Logger, API
} from 'homebridge';
import {Platform} from './Platform';
import {StreamingDelegate} from "./StreamingDelegate";
import {Config} from "./Config";
import {Camera} from "./sdm/Camera";
import {Doorbell} from "./sdm/Doorbell";

export class CameraAccessory {
    private hap: HAP;
    private camera: Camera;

    constructor(
        private readonly api: API,
        private readonly log: Logger,
        private readonly platform: Platform,
        private readonly accessory: PlatformAccessory) {
        this.hap = api.hap;
        this.camera = <Camera>accessory.context.device;
        // set accessory information
        new this.hap.Service.AccessoryInformation()
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest')

        accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            log.info("%s identified!", accessory.displayName);
        });

        // if (this.camera instanceof Doorbell) {
        //     const doorbell = new this.hap.Service.Doorbell(this.camera.getDisplayName() + ' Doorbell');
        //     accessory.addService(doorbell);
        //     doorbell.
        // }

        const streamingDelegate = new StreamingDelegate(log, api, this.platform.config.options as unknown as Config, this.camera);
        accessory.configureController(streamingDelegate.controller);
    }
}
