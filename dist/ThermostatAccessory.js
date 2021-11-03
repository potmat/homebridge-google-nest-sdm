"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThermostatAccessory = void 0;
const lodash_1 = __importDefault(require("lodash"));
const Traits = __importStar(require("./sdm/Traits"));
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
        this.service = accessory.getService(this.api.hap.Service.Thermostat);
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
            .onSet(this.handleTargetTemperatureSet.bind(this));
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
    handleCurrentTemperatureUpdate(temparature) {
        this.log.debug('Update CurrentTemperature:' + temparature);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temparature);
    }
    handleTargetTemperatureUpdate(temparature) {
        this.log.debug('Update TargetTemperature:' + temparature);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temparature);
    }
    handleCurrentRelativeHumidityUpdate(humidity) {
        this.log.debug('Update CurrentRelativeHumidity:' + humidity);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
    }
    handleCurrentHeatingCoolingStateUpdate(status) {
        this.log.debug('Update CurrentHeatingCoolingState:' + status);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.convertHvacStatusType(status));
    }
    handleTargetHeatingCoolingStateUpdate(status) {
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
    convertHvacStatusType(mode) {
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
    convertThermostatModeType(mode) {
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
    async handleTargetHeatingCoolingStateSet(value) {
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