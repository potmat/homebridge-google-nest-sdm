import {
    PlatformAccessory,
    CharacteristicValue,
    PlatformAccessoryEvent,
    HAP,
    Logger, API
} from 'homebridge';
import _ from "lodash";
import {Platform} from './Platform';
import {Thermostat} from "./SdmApi";

export class ThermostatAccessory {
    private hap: HAP;
    private thermostat: Thermostat;

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
        let service = accessory.getService(this.api.hap.Service.Thermostat);
        if (!service) {
            service = accessory.addService(this.api.hap.Service.Thermostat);
        }

        service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
            .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

        service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
            .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

        service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTemperatureGet.bind(this));

        service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .onGet(this.handleTargetTemperatureGet.bind(this))
            .onSet(this.handleTargetTemperatureSet.bind(this));

        service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
            .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));
    }

    /**
     * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
     */
    async handleCurrentHeatingCoolingStateGet() {
        this.log.debug('Triggered GET CurrentHeatingCoolingState');

        // set this to a valid value for CurrentHeatingCoolingState
        const mode = await this.thermostat.getHvac();

        switch (mode) {
            case 'HEATING':
                return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
            case 'COOLING':
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

        switch (mode) {
            case 'HEAT':
                return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
            case 'COOL':
                return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
            case 'HEATCOOL':
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

        let mode = 'OFF';
        switch (value) {
            case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
                mode = 'HEAT';
                break;
            case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
                mode = 'COOL';
                break;
            case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
                mode = 'HEATCOOL';
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
    handleTemperatureDisplayUnitsGet() {
        this.log.debug('Triggered GET TemperatureDisplayUnits');

        return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }

    /**
     * Handle requests to set the "Temperature Display Units" characteristic
     */
    handleTemperatureDisplayUnitsSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET TemperatureDisplayUnits:' + value);
    }

}
