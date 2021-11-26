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
const Traits_1 = require("./sdm/Traits");
const Accessory_1 = require("./Accessory");
class ThermostatAccessory extends Accessory_1.Accessory {
    constructor(api, log, platform, accessory, device) {
        super(api, log, platform, accessory, device);
        this.accessory.on("identify" /* IDENTIFY */, () => {
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
    handleCurrentTemperatureUpdate(temperature) {
        this.log.debug('Update CurrentTemperature:' + temperature);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temperature);
    }
    convertTemperatureDisplayUnits(unit) {
        switch (unit) {
            case Traits_1.TemperatureScale.CELSIUS:
                return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
            case Traits_1.TemperatureScale.FAHRENHEIT:
                return this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
            default:
                return null;
        }
    }
    handleTemperatureScaleUpdate(unit) {
        this.log.debug('Update TemperatureUnits:' + unit);
        let converted = this.convertTemperatureDisplayUnits(unit);
        if (converted)
            this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, converted);
    }
    handleTargetTemperatureUpdate(temperature) {
        this.log.debug('Update TargetTemperature:' + temperature);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temperature);
    }
    handleCurrentRelativeHumidityUpdate(humidity) {
        this.log.debug('Update CurrentRelativeHumidity:' + humidity);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
    }
    handleCurrentHeatingCoolingStateUpdate(status) {
        this.log.debug('Update CurrentHeatingCoolingState:' + status);
        let converted = this.convertHvacStatusType(status);
        if (converted)
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, converted);
    }
    handleTargetHeatingCoolingStateUpdate(status) {
        this.log.debug('Update TargetHeatingCoolingState:' + status);
        let converted = this.convertThermostatModeType(status);
        if (converted)
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, converted);
    }
    /**
     * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
     */
    async handleCurrentHeatingCoolingStateGet() {
        this.log.debug('Triggered GET CurrentHeatingCoolingState');
        let hvac = await this.device.getHvac();
        return this.convertHvacStatusType(hvac === null || hvac === void 0 ? void 0 : hvac.status);
    }
    convertHvacStatusType(mode) {
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
    async handleTargetHeatingCoolingStateGet() {
        this.log.debug('Triggered GET TargetHeatingCoolingState');
        let mode = await this.device.getMode();
        return this.convertThermostatModeType(mode === null || mode === void 0 ? void 0 : mode.mode);
    }
    convertThermostatModeType(mode) {
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
        await this.device.setMode(mode);
    }
    /**
     * Handle requests to get the current value of the "Current Temperature" characteristic
     */
    async handleCurrentTemperatureGet() {
        this.log.debug('Triggered GET CurrentTemperature');
        return await this.convertToNullable(this.device.getTemperature());
    }
    /**
     * Handle requests to get the current value of the "Current Relative Humidity" characteristic
     */
    async handleCurrentRelativeHumidityGet() {
        this.log.debug('Triggered GET CurrentTemperature');
        return await this.convertToNullable(this.device.getRelativeHumitity());
    }
    /**
     * Handle requests to get the current value of the "Target Temperature" characteristic
     */
    async handleTargetTemperatureGet() {
        this.log.debug('Triggered GET TargetTemperature');
        return await this.convertToNullable(this.device.getTargetTemperature());
    }
    /**
     * Handle requests to set the "Target Temperature" characteristic
     */
    async handleTargetTemperatureSet(value) {
        this.log.debug('Triggered SET TargetTemperature:' + value);
        if (!lodash_1.default.isNumber(value))
            throw new Error(`Cannot set "${value}" as temperature.`);
        await this.device.setTemperature(value);
    }
    /**
     * Handle requests to get the current value of the "Temperature Display Units" characteristic
     */
    async handleTemperatureDisplayUnitsGet() {
        this.log.debug('Triggered GET TemperatureDisplayUnits');
        return this.convertTemperatureDisplayUnits(await this.device.getTemperatureUnits());
    }
}
exports.ThermostatAccessory = ThermostatAccessory;
//# sourceMappingURL=ThermostatAccessory.js.map