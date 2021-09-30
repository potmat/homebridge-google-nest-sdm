"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThermostatAccessory = void 0;
const lodash_1 = __importDefault(require("lodash"));
class ThermostatAccessory {
    constructor(api, log, platform, accessory) {
        var _a;
        this.api = api;
        this.log = log;
        this.platform = platform;
        this.accessory = accessory;
        this.hap = api.hap;
        this.thermostat = accessory.context.device;
        // set accessory information
        (_a = new this.hap.Service.AccessoryInformation()) === null || _a === void 0 ? void 0 : _a.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest');
        accessory.on("identify" /* IDENTIFY */, () => {
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
        service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
            .onGet(this.handleCurrentRelativeHumidityGet.bind(this));
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
    async handleTargetHeatingCoolingStateSet(value) {
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
    async handleTargetTemperatureSet(value) {
        this.log.debug('Triggered SET TargetTemperature:' + value);
        if (!lodash_1.default.isNumber(value))
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
    handleTemperatureDisplayUnitsSet(value) {
        this.log.debug('Triggered SET TemperatureDisplayUnits:' + value);
    }
}
exports.ThermostatAccessory = ThermostatAccessory;
//# sourceMappingURL=ThermostatAccessory.js.map