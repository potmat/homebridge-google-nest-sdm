import {API, CharacteristicValue, Logger, PlatformAccessory, PlatformAccessoryEvent, Service} from 'homebridge';
import * as Traits from './sdm/Traits';
import {FanTimerModeType} from './sdm/Traits';
import {Platform} from './Platform';
import {Thermostat} from "./sdm/Thermostat";
import {Accessory} from "./Accessory";
import _ from "lodash";
import {Config} from "./Config";

export class FanAccessory extends Accessory<Thermostat> {

    private readonly service: Service;
    private config: Config;

    constructor(
        api: API,
        log: Logger,
        platform: Platform,
        accessory: PlatformAccessory,
        device: Thermostat) {
        super(api, log, platform, accessory, device);

        this.config = platform.platformConfig as unknown as Config

        this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            log.info("%s fan identified!", accessory.displayName);
        });

        // create a new Thermostat service
        this.service = <Service>accessory.getService(this.api.hap.Service.Fan);
        if (!this.service) {
            this.service = accessory.addService(this.api.hap.Service.Fan);
        }

        this.service.getCharacteristic(this.platform.Characteristic.On)
            .onGet(this.handleOnGet.bind(this))
            .onSet(this.handleOnSet.bind(this));

        this.device.onFanChanged = this.handleFanUpdate.bind(this);
    }

    private handleFanUpdate(fan: Traits.Fan) {
        this.log.debug('Update Fan:' + fan.timerMode, this.accessory.displayName);
        this.service.updateCharacteristic(this.platform.Characteristic.On, fan.timerMode === FanTimerModeType.ON);
    }

    /**
     * Handle requests to set the "On" characteristic
     */
    private async handleOnSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET Fan', this.accessory.displayName);

        if (!_.isBoolean(value))
            throw new Error(`Cannot set "${value}" as fan state.`);
        if (this.config.fanDuration && (this.config.fanDuration < 1 || this.config.fanDuration > 43200))
            throw new Error(`Cannot set "${this.config.fanDuration}" as fan duration.`);

        await this.device.setFan((value as boolean) ? Traits.FanTimerModeType.ON : FanTimerModeType.OFF, this.config.fanDuration)
    }

    /**
     * Handle requests to get the current value of the "On" characteristic
     */
    private async handleOnGet() {
        this.log.debug('Triggered GET Fan On', this.accessory.displayName);

        const fan = await this.device.getFan();
        switch(fan?.timerMode) {
            case FanTimerModeType.ON:
                return true;
            default:
                return false;
        }
    }
}