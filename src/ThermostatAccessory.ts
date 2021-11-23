import {
    API,
    CharacteristicValue,
    Logger,
    Nullable,
    PlatformAccessory,
    PlatformAccessoryEvent,
    Service
} from 'homebridge';
import _ from "lodash";
import * as Traits from './sdm/Traits';
import {TemperatureScale} from './sdm/Traits';
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
            .onGet(this.handleTemperatureDisplayUnitsGet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
            .onGet(this.handleCurrentRelativeHumidityGet.bind(this));

        this.device.onTemperatureChanged = this.handleCurrentTemperatureUpdate.bind(this);
        this.device.onTemperatureUnitsChanged = this.handleTemperatureScaleUpdate.bind(this);
        this.device.onTargetTemperatureChanged = this.handleTargetTemperatureUpdate.bind(this);
        this.device.onHumidityChanged = this.handleCurrentRelativeHumidityUpdate.bind(this);
        this.device.onHvacChanged = this.handleCurrentHeatingCoolingStateUpdate.bind(this);
        this.device.onModeChanged = this.handleTargetHeatingCoolingStateUpdate.bind(this);
    }

    handleCurrentTemperatureUpdate(temperature: number) {
        this.log.debug('Update CurrentTemperature:' + temperature);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temperature);
    }

    private convertTemperatureDisplayUnits(unit: Traits.TemperatureScale | undefined): Nullable<CharacteristicValue> {
        switch (unit) {
            case TemperatureScale.CELSIUS:
                return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
            case TemperatureScale.FAHRENHEIT:
                return this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
            default:
                return null;
        }
    }

    handleTemperatureScaleUpdate(unit: Traits.TemperatureScale) {
        this.log.debug('Update TemperatureUnits:' + unit);
        let converted = this.convertTemperatureDisplayUnits(unit);
        if (converted)
            this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, converted);
    }

    handleTargetTemperatureUpdate(temperature: number) {
        this.log.debug('Update TargetTemperature:' + temperature);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temperature);
    }

    handleCurrentRelativeHumidityUpdate(humidity: number) {
        this.log.debug('Update CurrentRelativeHumidity:' + humidity);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
    }

    handleCurrentHeatingCoolingStateUpdate(status: Traits.HvacStatusType) {
        this.log.debug('Update CurrentHeatingCoolingState:' + status);
        let converted = this.convertHvacStatusType(status);
        if (converted)
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, converted);
    }

    handleTargetHeatingCoolingStateUpdate(status: Traits.ThermostatModeType) {
        this.log.debug('Update TargetHeatingCoolingState:' + status);
        let converted = this.convertThermostatModeType(status);
        if (converted)
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, converted);
    }

    /**
     * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
     */
    async handleCurrentHeatingCoolingStateGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET CurrentHeatingCoolingState');
        return this.convertHvacStatusType(await this.device.getHvac());
    }

    private convertHvacStatusType(mode: Traits.HvacStatusType | undefined): Nullable<CharacteristicValue> {
        switch (mode) {
            case Traits.HvacStatusType.HEATING:
                return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
            case Traits.HvacStatusType.COOLING:
                return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
            case Traits.HvacStatusType.OFF:
                return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
            default:
                return null;
        }
    }

    /**
     * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
     */
    async handleTargetHeatingCoolingStateGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET TargetHeatingCoolingState');
        return this.convertThermostatModeType(await this.device.getMode());
    }

    private convertThermostatModeType(mode: Traits.ThermostatModeType | undefined): Nullable<CharacteristicValue> {
        switch (mode) {
            case Traits.ThermostatModeType.HEAT:
                return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
            case Traits.ThermostatModeType.COOL:
                return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
            case Traits.ThermostatModeType.HEATCOOL:
                return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
            case Traits.ThermostatModeType.OFF:
                return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
            default:
                return null;
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
    async handleCurrentTemperatureGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET CurrentTemperature');
        return await this.convertToNullable(this.device.getTemperature());
    }

    /**
     * Handle requests to get the current value of the "Current Relative Humidity" characteristic
     */
    async handleCurrentRelativeHumidityGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET CurrentTemperature');
        return await this.convertToNullable(this.device.getRelativeHumitity());
    }


    /**
     * Handle requests to get the current value of the "Target Temperature" characteristic
     */
    async handleTargetTemperatureGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET TargetTemperature');
        return await this.convertToNullable(this.device.getTargetTemperature());
    }

    /**
     * Handle requests to set the "Target Temperature" characteristic
     */
    async handleTargetTemperatureSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET TargetTemperature:' + value);

        if (!_.isNumber(value))
            throw new Error(`Cannot set "${value}" as temperature.`);

        await this.device.setTemperature(value);
    }

    /**
     * Handle requests to get the current value of the "Temperature Display Units" characteristic
     */
    async handleTemperatureDisplayUnitsGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET TemperatureDisplayUnits');
        return this.convertTemperatureDisplayUnits(await this.device.getTemperatureUnits());
    }
}
