import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    PlatformAccessoryEvent,
    Logger, API
} from 'homebridge';
import _ from "lodash";
import * as Traits from './sdm/Traits';
import {Platform} from './Platform';
import {Thermostat} from "./sdm/Thermostat";
import {Accessory} from "./Accessory";

export class ThermostatAccessory extends Accessory<Thermostat> {
    private service: Service;

    constructor(
        api: API,
        log: Logger,
        platform: Platform,
        accessory: PlatformAccessory,
        device: Thermostat) {
        super(api, log, platform, accessory, device);

        this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            log.info("%s identified!", accessory.displayName);
        });

        // create a new Thermostat service
        this.service = <Service>accessory.getService(this.api.hap.Service.Thermostat);
        if (!this.service) {
            this.service = accessory.addService(this.api.hap.Service.Thermostat);
        }

        this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
            .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
            .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTemperatureGet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .onGet(this.handleTargetTemperatureGet.bind(this))
            .onSet(this.handleTargetTemperatureSet.bind(this))

        this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
            .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
            .onGet(this.handleCurrentRelativeHumidityGet.bind(this));

        this.device.onTemperatureChanged = this.handleCurrentTemperatureUpdate.bind(this);
        this.device.onTemperatureUnitsChanged = this.handleTemparatureScaleUpdate.bind(this);
        this.device.onTargetTemperatureChanged = this.handleTargetTemperatureUpdate.bind(this);
        this.device.onHumidityChanged = this.handleCurrentRelativeHumidityUpdate.bind(this);
        this.device.onHvacChanged = this.handleCurrentHeatingCoolingStateUpdate.bind(this);
        this.device.onModeChanged = this.handleTargetHeatingCoolingStateUpdate.bind(this);
    }

    handleCurrentTemperatureUpdate(temparature: number) {
        this.log.debug('Update CurrentTemperature:' + temparature);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temparature);
    }

    handleTemparatureScaleUpdate(unit: Traits.TemparatureScale) {
        this.log.debug('Update TemperatureUnits:' + unit);
        this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, unit);
    }

    handleTargetTemperatureUpdate(temparature: number) {
        this.log.debug('Update TargetTemperature:' + temparature);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temparature);
    }

    handleCurrentRelativeHumidityUpdate(humidity: number) {
        this.log.debug('Update CurrentRelativeHumidity:' + humidity);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
    }

    handleCurrentHeatingCoolingStateUpdate(status: Traits.HvacStatusType) {
        this.log.debug('Update CurrentHeatingCoolingState:' + status);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.convertHvacStatusType(status));
    }

    handleTargetHeatingCoolingStateUpdate(status: Traits.ThermostatModeType) {
        this.log.debug('Update TargetHeatingCoolingState:' + status);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.convertThermostatModeType(status));
    }

    /**
     * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
     */
    async handleCurrentHeatingCoolingStateGet() {
        this.log.debug('Triggered GET CurrentHeatingCoolingState');

        // set this to a valid value for CurrentHeatingCoolingState
        const mode = await this.device.getHvac();
        return this.convertHvacStatusType(mode);
    }

    private convertHvacStatusType(mode: Traits.HvacStatusType) {
        switch (mode) {
            case Traits.HvacStatusType.HEATING:
                return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
            case Traits.HvacStatusType.COOLING:
                return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
            default:
                return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
        }
    }

    /**
     * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
     */
    async handleTargetHeatingCoolingStateGet() {
        this.log.debug('Triggered GET TargetHeatingCoolingState');

        // set this to a valid value for CurrentHeatingCoolingState
        const mode = await this.device.getMode();
        return this.convertThermostatModeType(mode);
    }

    private convertThermostatModeType(mode: Traits.ThermostatModeType) {
        switch (mode) {
            case Traits.ThermostatModeType.HEAT:
                return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
            case Traits.ThermostatModeType.COOL:
                return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
            case Traits.ThermostatModeType.HEATCOOL:
                return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
            default:
                return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
        }
    }

    /**
     * Handle requests to set the "Target Heating Cooling State" characteristic
     */
    async handleTargetHeatingCoolingStateSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET TargetHeatingCoolingState:' + value);

        let mode = Traits.ThermostatModeType.OFF;
        switch (value) {
            case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
                mode = Traits.ThermostatModeType.HEAT;
                break;
            case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
                mode = Traits.ThermostatModeType.COOL;
                break;
            case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
                mode = Traits.ThermostatModeType.HEATCOOL;
                break;
        }

        await this.device.setMode(mode);
    }

    /**
     * Handle requests to get the current value of the "Current Temperature" characteristic
     */
    async handleCurrentTemperatureGet() {
        this.log.debug('Triggered GET CurrentTemperature');

        return await this.device.getTemparature();
    }

    /**
     * Handle requests to get the current value of the "Current Relative Humidity" characteristic
     */
    async handleCurrentRelativeHumidityGet() {
        this.log.debug('Triggered GET CurrentTemperature');

        return await this.device.getRelativeHumitity();
    }


    /**
     * Handle requests to get the current value of the "Target Temperature" characteristic
     */
    async handleTargetTemperatureGet() {
        this.log.debug('Triggered GET TargetTemperature');

        return await this.device.getTargetTemparature() || null;
    }

    /**
     * Handle requests to set the "Target Temperature" characteristic
     */
    async handleTargetTemperatureSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET TargetTemperature:' + value);

        if (!_.isNumber(value))
            throw new Error(`Cannot set "${value}" as temparature.`);

        await this.device.setTemparature(value);
    }

    /**
     * Handle requests to get the current value of the "Temperature Display Units" characteristic
     */
    async handleTemperatureDisplayUnitsGet() {
        this.log.debug('Triggered GET TemperatureDisplayUnits');

        const temparatureUnit = await this.device.getTemparatureUnits();

        if (temparatureUnit === Traits.TemparatureScale.CELSIUS)
            return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
        else
            return this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    }

    /**
     * Handle requests to set the "Temperature Display Units" characteristic
     */
    handleTemperatureDisplayUnitsSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET TemperatureDisplayUnits:' + value);
    }
}
