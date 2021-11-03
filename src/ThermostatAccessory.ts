import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    PlatformAccessoryEvent,
    HAP,
    Logger, API
} from 'homebridge';
import _ from "lodash";
import * as Traits from './sdm/Traits';
import {Platform} from './Platform';
import {Thermostat} from "./sdm/Thermostat";


export class ThermostatAccessory {
    private hap: HAP;
    private thermostat: Thermostat;
    private service: Service;

    constructor(
        private readonly api: API,
        private readonly log: Logger,
        private readonly platform: Platform,
        private readonly accessory: PlatformAccessory) {
        this.hap = api.hap;
        this.thermostat = <Thermostat>accessory.context.device;

        // set accessory information
       new this.hap.Service.AccessoryInformation()
            ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest')

        accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
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

        this.thermostat.onTemperatureChanged = this.handleCurrentTemperatureUpdate.bind(this);
        this.thermostat.onTargetTemperatureChanged = this.handleTargetTemperatureUpdate.bind(this);
        this.thermostat.onHumidityChanged = this.handleCurrentRelativeHumidityUpdate.bind(this);
        this.thermostat.onHvacChanged = this.handleCurrentHeatingCoolingStateUpdate.bind(this);
        this.thermostat.onModeChanged = this.handleTargetHeatingCoolingStateUpdate.bind(this);
    }

    handleCurrentTemperatureUpdate(temparature: number) {
        this.log.debug('Update CurrentTemperature:' + temparature);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temparature);
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
        const mode = await this.thermostat.getHvac();
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
        const mode = await this.thermostat.getMode();
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

        await this.thermostat.setMode(mode);
    }

    /**
     * Handle requests to get the current value of the "Current Temperature" characteristic
     */
    async handleCurrentTemperatureGet() {
        this.log.debug('Triggered GET CurrentTemperature');

        return await this.thermostat.getTemparature();
    }

    /**
     * Handle requests to get the current value of the "Current Relative Humidity" characteristic
     */
    async handleCurrentRelativeHumidityGet() {
        this.log.debug('Triggered GET CurrentTemperature');

        return await this.thermostat.getRelativeHumitity();
    }


    /**
     * Handle requests to get the current value of the "Target Temperature" characteristic
     */
    async handleTargetTemperatureGet() {
        this.log.debug('Triggered GET TargetTemperature');

        return await this.thermostat.getTargetTemparature() || null;
    }

    /**
     * Handle requests to set the "Target Temperature" characteristic
     */
    async handleTargetTemperatureSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET TargetTemperature:' + value);

        if (!_.isNumber(value))
            throw new Error(`Cannot set "${value}" as temparature.`);

        await this.thermostat.setTemparature(value);
    }

    /**
     * Handle requests to get the current value of the "Temperature Display Units" characteristic
     */
    async handleTemperatureDisplayUnitsGet() {
        this.log.debug('Triggered GET TemperatureDisplayUnits');

        const temparatureUnit = await this.thermostat.getTemparatureUnits();

        if (temparatureUnit === 'CELSIUS')
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
