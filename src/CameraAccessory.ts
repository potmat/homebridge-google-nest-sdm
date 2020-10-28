import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    CharacteristicSetCallback,
    CharacteristicGetCallback,
    PlatformAccessoryEvent,
    HAP,
    CameraControllerOptions,
    Logger, API
} from 'homebridge';
import { Platform } from './Platform';
import {StreamingDelegate} from "./StreamingDelegate";
import {Camera} from "./SdmApi";
import {Config} from "./Config";

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CameraAccessory {
    private hap: HAP;

    constructor(
        private readonly api: API,
        private readonly log: Logger,
        private readonly platform: Platform,
        private readonly accessory: PlatformAccessory) {
            this.hap = api.hap;
            // set accessory information
            this.accessory.getService(this.platform.Service.AccessoryInformation)!
                .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest')

            accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
              log.info("%s identified!", accessory.displayName);
            });

            const streamingDelegate = new StreamingDelegate(log, api, this.platform.config.options as unknown as Config, <Camera>accessory.context.device);
            accessory.configureController(streamingDelegate.controller);
        }
}
