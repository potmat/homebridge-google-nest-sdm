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
        let ecoMode = this.service.getCharacteristic(this.platform.Characteristic.EcoMode);
        if (!ecoMode)
            ecoMode = this.service.addCharacteristic(this.platform.Characteristic.EcoMode);
        ecoMode
            .onGet(this.handleEcoModeGet.bind(this))
            .onSet(this.handleEcoModeSet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
            .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
            .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTemperatureGet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onGet(this.handleTemperatureDisplayUnitsGet.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
            .onGet(this.handleCurrentRelativeHumidityGet.bind(this));
        this.device.onTemperatureChanged = this.handleCurrentTemperatureUpdate.bind(this);
        this.device.onTemperatureUnitsChanged = this.handleTemperatureScaleUpdate.bind(this);
        this.device.onTargetTemperatureChanged = this.handleTargetTemperatureUpdate.bind(this);
        this.device.onTargetTemperatureRangeChanged = this.handleTargetTemperatureRangeUpdate.bind(this);
        this.device.onHumidityChanged = this.handleCurrentRelativeHumidityUpdate.bind(this);
        this.device.onHvacChanged = this.handleCurrentHeatingCoolingStateUpdate.bind(this);
        this.device.onModeChanged = this.handleTargetHeatingCoolingStateUpdate.bind(this);
        this.device.onEcoChanged = this.handleEcoUpdate.bind(this);
        void this.initialize();
    }
    async initialize() {
        await this.setupEvents();
        await this.syncCharacteristics();
    }
    isEcoActive(eco) {
        return (eco === null || eco === void 0 ? void 0 : eco.mode) !== undefined && eco.mode !== Traits_1.EcoModeType.OFF;
    }
    async syncCharacteristics() {
        const [temp, humidity, hvac, mode, eco, units, targetTemp, range] = await Promise.all([
            this.device.getTemperature(),
            this.device.getRelativeHumitity(),
            this.device.getHvac(),
            this.device.getMode(),
            this.device.getEco(),
            this.device.getTemperatureUnits(),
            this.device.getTargetTemperature(),
            this.device.getTargetTemperatureRange()
        ]);
        if (temp !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temp);
        }
        if (humidity !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
        }
        const convertedHvac = this.convertHvacStatusType(hvac === null || hvac === void 0 ? void 0 : hvac.status);
        if (convertedHvac !== null) {
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, convertedHvac);
        }
        const convertedMode = this.convertThermostatModeType(mode === null || mode === void 0 ? void 0 : mode.mode);
        if (convertedMode !== null) {
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, convertedMode);
        }
        this.service.updateCharacteristic(this.platform.Characteristic.EcoMode, this.isEcoActive(eco));
        const convertedUnits = this.convertTemperatureDisplayUnits(units);
        if (convertedUnits !== null) {
            this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, convertedUnits);
        }
        if (targetTemp !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, targetTemp);
        }
        if ((range === null || range === void 0 ? void 0 : range.heat) !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, range.heat);
        }
        if ((range === null || range === void 0 ? void 0 : range.cool) !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, range.cool);
        }
    }
    async setupEvents() {
        var _a;
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).removeOnSet();
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).removeOnSet();
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).removeOnSet();
        const tempUnits = await this.device.getTemperatureUnits();
        const ecoActive = this.isEcoActive(await this.device.getEco());
        let minSetTemp, maxSetTemp, minGetTemp, maxGetTemp;
        if (tempUnits == Traits_1.TemperatureScale.FAHRENHEIT) {
            minSetTemp = this.fahrenheitToCelsius(ecoActive ? 40 : 50);
            maxSetTemp = this.fahrenheitToCelsius(90);
            minGetTemp = this.fahrenheitToCelsius(0);
            maxGetTemp = this.fahrenheitToCelsius(160);
        }
        else {
            minSetTemp = ecoActive ? 4.5 : 9;
            maxSetTemp = 32;
            minGetTemp = -20;
            maxGetTemp = 60;
        }
        const targetMode = await this.device.getMode();
        if ((_a = targetMode === null || targetMode === void 0 ? void 0 : targetMode.availableModes) === null || _a === void 0 ? void 0 : _a.length) {
            this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
                .setProps({
                validValues: lodash_1.default.map(targetMode.availableModes, (availableMode) => this.convertThermostatModeType(availableMode))
            });
        }
        switch (targetMode === null || targetMode === void 0 ? void 0 : targetMode.mode) {
            case Traits_1.ThermostatModeType.HEATCOOL:
                this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
                    .onGet(this.handleCoolingThresholdTemperatureGet.bind(this))
                    .onSet(this.handleCoolingThresholdTemperatureSet.bind(this));
                this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
                    .onGet(this.handleHeatingThresholdTemperatureGet.bind(this))
                    .onSet(this.handleHeatingThresholdTemperatureSet.bind(this));
                break;
            case Traits_1.ThermostatModeType.HEAT:
            case Traits_1.ThermostatModeType.COOL:
                this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
                    .onGet(this.handleHeatingThresholdTemperatureGet.bind(this));
                this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
                    .onGet(this.handleCoolingThresholdTemperatureGet.bind(this));
                this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
                    .onGet(this.handleTargetTemperatureGet.bind(this))
                    .onSet(this.handleTargetTemperatureSet.bind(this));
                break;
        }
        this.setCharactersticProps(minGetTemp, maxGetTemp, minSetTemp, maxSetTemp);
        this.log.debug('Events reset.', this.accessory.displayName);
    }
    setCharactersticProps(minGetTemp, maxGetTemp, minSetTemp, maxSetTemp) {
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
            minValue: minGetTemp,
            maxValue: maxGetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
            minValue: minSetTemp,
            maxValue: maxSetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).setProps({
            minValue: minSetTemp,
            maxValue: maxSetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).setProps({
            minValue: minSetTemp,
            maxValue: maxSetTemp
        });
    }
    fahrenheitToCelsius(temperature) {
        return (temperature - 32) / 1.8;
    }
    ;
    handleCurrentTemperatureUpdate(temperature) {
        this.log.debug('Update CurrentTemperature:' + temperature, this.accessory.displayName);
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
        this.log.debug('Update TemperatureUnits:' + unit, this.accessory.displayName);
        let converted = this.convertTemperatureDisplayUnits(unit);
        if (converted !== null)
            this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, converted);
    }
    handleTargetTemperatureUpdate(temperature) {
        this.log.debug('Update TargetTemperature:' + temperature, this.accessory.displayName);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temperature);
    }
    handleTargetTemperatureRangeUpdate(range) {
        this.log.debug('Update TargetTemperatureRange:' + range, this.accessory.displayName);
        if (range.heat)
            this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, range.heat);
        if (range.cool)
            this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, range.cool);
    }
    handleCurrentRelativeHumidityUpdate(humidity) {
        this.log.debug('Update CurrentRelativeHumidity:' + humidity, this.accessory.displayName);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
    }
    handleCurrentHeatingCoolingStateUpdate(status) {
        this.log.debug('Update CurrentHeatingCoolingState:' + status, this.accessory.displayName);
        let converted = this.convertHvacStatusType(status);
        if (converted !== null)
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, converted);
    }
    async syncTargetTemperatures() {
        const targetTemp = await this.device.getTargetTemperature();
        if (targetTemp !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, targetTemp);
        }
        const range = await this.device.getTargetTemperatureRange();
        if ((range === null || range === void 0 ? void 0 : range.heat) !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, range.heat);
        }
        if ((range === null || range === void 0 ? void 0 : range.cool) !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, range.cool);
        }
    }
    async handleTargetHeatingCoolingStateUpdate(status) {
        this.log.debug(`Update TargetHeatingCoolingState:${status}`, this.accessory.displayName);
        await this.setupEvents();
        let converted = this.convertThermostatModeType(status);
        if (converted !== null)
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, converted);
        await this.syncTargetTemperatures();
    }
    async handleEcoUpdate(mode) {
        this.log.debug(`Update EcoMode: ${mode.mode}`, this.accessory.displayName);
        await this.setupEvents();
        this.service.updateCharacteristic(this.platform.Characteristic.EcoMode, this.isEcoActive(mode));
        await this.syncTargetTemperatures();
    }
    /**
     * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
     */
    async handleCurrentHeatingCoolingStateGet() {
        this.log.debug('Triggered GET CurrentHeatingCoolingState', this.accessory.displayName);
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
        this.log.debug('Triggered GET TargetHeatingCoolingState', this.accessory.displayName);
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
    async syncEcoAfterWrite(wasEcoActive, resetEvents = true) {
        if (!wasEcoActive) {
            return;
        }
        const ecoActive = this.isEcoActive(await this.device.getEco());
        if (!ecoActive) {
            this.service.updateCharacteristic(this.platform.Characteristic.EcoMode, false);
            if (resetEvents) {
                await this.setupEvents();
            }
        }
    }
    /**
     * Handle requests to set the "Target Heating Cooling State" characteristic
     */
    async handleTargetHeatingCoolingStateSet(value) {
        this.log.debug('Triggered SET TargetHeatingCoolingState:' + value, this.accessory.displayName);
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
        const wasEcoActive = this.isEcoActive(await this.device.getEco());
        await this.device.setMode(mode);
        await this.setupEvents();
        await this.syncEcoAfterWrite(wasEcoActive, false);
        await this.syncTargetTemperatures();
    }
    /**
     * Handle requests to get the current value of the "Current Temperature" characteristic
     */
    async handleCurrentTemperatureGet() {
        this.log.debug('Triggered GET CurrentTemperature', this.accessory.displayName);
        return await this.convertToNullable(this.device.getTemperature());
    }
    /**
     * Handle requests to get the current value of the "Current Relative Humidity" characteristic
     */
    async handleCurrentRelativeHumidityGet() {
        this.log.debug('Triggered GET CurrentTemperature', this.accessory.displayName);
        return await this.convertToNullable(this.device.getRelativeHumitity());
    }
    /**
     * Handle requests to get the current value of the "Target Temperature" characteristic
     */
    async handleTargetTemperatureGet() {
        this.log.debug('Triggered GET TargetTemperature', this.accessory.displayName);
        return await this.convertToNullable(this.device.getTargetTemperature());
    }
    /**
     * Handle requests to set the "Target Temperature" characteristic
     */
    async handleTargetTemperatureSet(value) {
        this.log.debug('Triggered SET TargetTemperature:' + value, this.accessory.displayName);
        if (!lodash_1.default.isNumber(value))
            throw new Error(`Cannot set "${value}" as temperature.`);
        const wasEcoActive = this.isEcoActive(await this.device.getEco());
        await this.device.setTargetTemperature(value);
        await this.syncEcoAfterWrite(wasEcoActive);
    }
    /**
     * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
     */
    async handleCoolingThresholdTemperatureGet() {
        var _a, _b, _c;
        this.log.debug('Triggered GET CoolingThresholdTemperature', this.accessory.displayName);
        const targetTemperatureRange = await this.device.getTargetTemperatureRange();
        const mode = await this.device.getMode();
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits_1.ThermostatModeType.COOL:
            case Traits_1.ThermostatModeType.HEATCOOL:
                return (_a = targetTemperatureRange === null || targetTemperatureRange === void 0 ? void 0 : targetTemperatureRange.cool) !== null && _a !== void 0 ? _a : null;
            case Traits_1.ThermostatModeType.HEAT:
                return (_c = (_b = targetTemperatureRange === null || targetTemperatureRange === void 0 ? void 0 : targetTemperatureRange.cool) !== null && _b !== void 0 ? _b : targetTemperatureRange === null || targetTemperatureRange === void 0 ? void 0 : targetTemperatureRange.heat) !== null && _c !== void 0 ? _c : null;
            default:
                return null;
        }
    }
    /**
     * Handle requests to set the "Cooling Threshold Temperature" characteristic
     */
    async handleCoolingThresholdTemperatureSet(value) {
        this.log.debug('Triggered SET CoolingThresholdTemperature:' + value, this.accessory.displayName);
        if (!lodash_1.default.isNumber(value))
            throw new Error(`Cannot set "${value}" as cooling threshold temperature.`);
        const wasEcoActive = this.isEcoActive(await this.device.getEco());
        await this.device.setTargetTemperatureRange(value, undefined);
        await this.syncEcoAfterWrite(wasEcoActive);
    }
    /**
     * Handle requests to get the current value of the "Heating Threshold Temperature" characteristic
     */
    async handleHeatingThresholdTemperatureGet() {
        var _a, _b, _c;
        this.log.debug('Triggered GET HeatingThresholdTemperatureGet', this.accessory.displayName);
        const targetTemperatureRange = await this.device.getTargetTemperatureRange();
        const mode = await this.device.getMode();
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits_1.ThermostatModeType.HEAT:
            case Traits_1.ThermostatModeType.HEATCOOL:
                return (_a = targetTemperatureRange === null || targetTemperatureRange === void 0 ? void 0 : targetTemperatureRange.heat) !== null && _a !== void 0 ? _a : null;
            case Traits_1.ThermostatModeType.COOL:
                return (_c = (_b = targetTemperatureRange === null || targetTemperatureRange === void 0 ? void 0 : targetTemperatureRange.heat) !== null && _b !== void 0 ? _b : targetTemperatureRange === null || targetTemperatureRange === void 0 ? void 0 : targetTemperatureRange.cool) !== null && _c !== void 0 ? _c : null;
            default:
                return null;
        }
    }
    /**
     * Handle requests to set the "Heating Threshold Temperature" characteristic
     */
    async handleHeatingThresholdTemperatureSet(value) {
        this.log.debug('Triggered SET HeatingThresholdTemperatureSet:' + value, this.accessory.displayName);
        if (!lodash_1.default.isNumber(value))
            throw new Error(`Cannot set "${value}" as heating threshold temperature.`);
        const wasEcoActive = this.isEcoActive(await this.device.getEco());
        await this.device.setTargetTemperatureRange(undefined, value);
        await this.syncEcoAfterWrite(wasEcoActive);
    }
    /**
     * Handle requests to get the current value of the "Temperature Display Units" characteristic
     */
    async handleTemperatureDisplayUnitsGet() {
        this.log.debug('Triggered GET TemperatureDisplayUnits', this.accessory.displayName);
        return this.convertTemperatureDisplayUnits(await this.device.getTemperatureUnits());
    }
    /**
     * Handle requests to get the current value of the "Eco" characteristic
     */
    async handleEcoModeGet() {
        this.log.debug('Triggered GET EcoMode', this.accessory.displayName);
        return await this.convertToNullable(this.device.getEco().then(eco => (eco === null || eco === void 0 ? void 0 : eco.mode) === Traits_1.EcoModeType.MANUAL_ECO));
    }
    /**
     * Handle requests to set the "Eco" characteristic
     */
    async handleEcoModeSet(value) {
        this.log.debug('Triggered SET EcoMode:' + value, this.accessory.displayName);
        await this.device.setEco(value ? Traits_1.EcoModeType.MANUAL_ECO : Traits_1.EcoModeType.OFF);
        await this.setupEvents();
        await this.syncTargetTemperatures();
    }
}
exports.ThermostatAccessory = ThermostatAccessory;
//# sourceMappingURL=ThermostatAccessory.js.map