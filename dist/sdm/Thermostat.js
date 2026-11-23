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
exports.Thermostat = void 0;
const lodash_1 = __importDefault(require("lodash"));
const Device_1 = require("./Device");
const Traits = __importStar(require("./Traits"));
const Traits_1 = require("./Traits");
const Commands = __importStar(require("./Commands"));
class Thermostat extends Device_1.Device {
    getDisplayName() {
        return this.displayName ? this.displayName + ' Thermostat' : 'Unknown';
    }
    isEcoActive(eco) {
        return (eco === null || eco === void 0 ? void 0 : eco.mode) !== undefined && eco.mode !== Traits.EcoModeType.OFF;
    }
    async ensureEcoOff() {
        const eco = await this.getEco();
        if (!this.isEcoActive(eco)) {
            return;
        }
        if (!this.ecoDisablePromise) {
            this.ecoDisablePromise = this.setEco(Traits.EcoModeType.OFF).finally(() => {
                this.ecoDisablePromise = undefined;
            });
        }
        await this.ecoDisablePromise;
    }
    event(event) {
        super.event(event);
        lodash_1.default.forEach(event.resourceUpdate.traits, (value, key) => {
            switch (key) {
                case Traits.Constants.ThermostatTemperatureSetpoint:
                    const setpoint = event.resourceUpdate.traits[Traits.Constants.ThermostatTemperatureSetpoint];
                    if (setpoint.coolCelsius === undefined && setpoint.heatCelsius === undefined)
                        return;
                    this.getMode()
                        .then(mode => {
                        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
                            case Traits_1.ThermostatModeType.HEATCOOL:
                                this.getTargetTemperatureRange().then(targetTemperatureRange => {
                                    if (this.onTargetTemperatureRangeChanged && targetTemperatureRange)
                                        this.onTargetTemperatureRangeChanged(targetTemperatureRange);
                                });
                                break;
                            case Traits_1.ThermostatModeType.HEAT:
                            case Traits_1.ThermostatModeType.COOL:
                                this.getTargetTemperature().then(targetTemperature => {
                                    if (this.onTargetTemperatureChanged && targetTemperature !== undefined)
                                        this.onTargetTemperatureChanged(targetTemperature);
                                });
                                break;
                        }
                    });
                    break;
                case Traits.Constants.ThermostatEco:
                    if (this.onEcoChanged) {
                        const traitValue = value;
                        this.onEcoChanged(traitValue);
                    }
                    break;
                case Traits.Constants.Fan:
                    if (this.onFanChanged) {
                        const traitValue = value;
                        this.onFanChanged(traitValue);
                    }
                    break;
                case Traits.Constants.ThermostatHvac:
                    if (this.onHvacChanged) {
                        const traitValue = value;
                        this.onHvacChanged(traitValue.status);
                    }
                    break;
                case Traits.Constants.Humidity:
                    if (this.onHumidityChanged) {
                        const traitVale = value;
                        this.onHumidityChanged(traitVale.ambientHumidityPercent);
                    }
                    break;
                case Traits.Constants.ThermostatMode:
                    if (this.onModeChanged) {
                        const traitVale = value;
                        this.onModeChanged(traitVale.mode);
                    }
                    break;
                case Traits.Constants.Temperature:
                    if (this.onTemperatureChanged) {
                        const traitVale = value;
                        this.onTemperatureChanged(traitVale.ambientTemperatureCelsius);
                    }
                    break;
                case Traits.Constants.Settings:
                    if (this.onTemperatureUnitsChanged) {
                        const traitVale = value;
                        this.onTemperatureUnitsChanged(traitVale.temperatureScale);
                    }
                    break;
                default:
                    break;
            }
        });
    }
    async getEco() {
        return await this.getTrait(Traits.Constants.ThermostatEco);
    }
    async getFan() {
        return await this.getTrait(Traits.Constants.Fan);
    }
    async getMode() {
        return await this.getTrait(Traits.Constants.ThermostatMode);
    }
    async getHvac() {
        return await this.getTrait(Traits.Constants.ThermostatHvac);
    }
    async getTemperature() {
        const trait = await this.getTrait(Traits.Constants.Temperature);
        return trait === null || trait === void 0 ? void 0 : trait.ambientTemperatureCelsius;
    }
    async getTargetTemperature() {
        const eco = await this.getEco();
        const mode = await this.getMode();
        if (this.isEcoActive(eco)) {
            switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
                case Traits.ThermostatModeType.HEAT:
                    return eco === null || eco === void 0 ? void 0 : eco.heatCelsius;
                case Traits.ThermostatModeType.COOL:
                    return eco === null || eco === void 0 ? void 0 : eco.coolCelsius;
                case Traits.ThermostatModeType.HEATCOOL:
                case Traits.ThermostatModeType.OFF:
                    return undefined;
            }
        }
        const trait = await this.getTrait(Traits.Constants.ThermostatTemperatureSetpoint);
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits.ThermostatModeType.OFF:
            case Traits.ThermostatModeType.HEATCOOL:
                return undefined;
            case Traits.ThermostatModeType.HEAT:
                return trait === null || trait === void 0 ? void 0 : trait.heatCelsius;
            case Traits.ThermostatModeType.COOL:
                return trait === null || trait === void 0 ? void 0 : trait.coolCelsius;
        }
    }
    async setTargetTemperature(temperature) {
        await this.ensureEcoOff();
        const mode = await this.getMode();
        const setpoint = await this.getTrait(Traits.Constants.ThermostatTemperatureSetpoint);
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits.ThermostatModeType.HEAT:
                await this.executeCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetHeat, { heatCelsius: temperature }, true);
                if (setpoint) {
                    setpoint.heatCelsius = temperature;
                }
                break;
            case Traits.ThermostatModeType.COOL:
                await this.executeCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetCool, { coolCelsius: temperature }, true);
                if (setpoint) {
                    setpoint.coolCelsius = temperature;
                }
                break;
            case Traits.ThermostatModeType.HEATCOOL:
                throw new Error('Cannot set a target temperature when the thermostat is in auto mode.');
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot set a target temperature when the thermostat is off.');
        }
    }
    async setTargetTemperatureRange(cool, heat) {
        var _a, _b;
        if (cool === undefined && heat === undefined) {
            throw new Error('At least one of heat/cool must be specified when setting a target temperature range.');
        }
        const previousRange = await this.getTargetTemperatureRange();
        await this.ensureEcoOff();
        const mode = await this.getMode();
        const setpoint = await this.getTrait(Traits.Constants.ThermostatTemperatureSetpoint);
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits.ThermostatModeType.HEATCOOL: {
                const currentRange = await this.getTargetTemperatureRange();
                const heatCelsius = (_a = heat !== null && heat !== void 0 ? heat : currentRange === null || currentRange === void 0 ? void 0 : currentRange.heat) !== null && _a !== void 0 ? _a : previousRange === null || previousRange === void 0 ? void 0 : previousRange.heat;
                const coolCelsius = (_b = cool !== null && cool !== void 0 ? cool : currentRange === null || currentRange === void 0 ? void 0 : currentRange.cool) !== null && _b !== void 0 ? _b : previousRange === null || previousRange === void 0 ? void 0 : previousRange.cool;
                if (heatCelsius === undefined || coolCelsius === undefined) {
                    throw new Error('Cannot determine both heat and cool temperatures for range update.');
                }
                await this.executeCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetRange, { heatCelsius, coolCelsius }, true);
                if (setpoint) {
                    setpoint.heatCelsius = heatCelsius;
                    setpoint.coolCelsius = coolCelsius;
                }
                break;
            }
            case Traits.ThermostatModeType.HEAT:
                if (heat === undefined)
                    throw new Error('Cannot set a target temperature range (heat only) when the thermostat is not in heat mode.');
                await this.executeCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetHeat, { heatCelsius: heat }, true);
                if (setpoint) {
                    setpoint.heatCelsius = heat;
                }
                break;
            case Traits.ThermostatModeType.COOL:
                if (cool === undefined)
                    throw new Error('Cannot set a target temperature range (cool only) when the thermostat is not in cool mode.');
                await this.executeCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetCool, { coolCelsius: cool }, true);
                if (setpoint) {
                    setpoint.coolCelsius = cool;
                }
                break;
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot set a target temperature when the thermostat is off.');
        }
    }
    async getTargetTemperatureRange() {
        const eco = await this.getEco();
        if (this.isEcoActive(eco)) {
            return {
                heat: eco === null || eco === void 0 ? void 0 : eco.heatCelsius,
                cool: eco === null || eco === void 0 ? void 0 : eco.coolCelsius
            };
        }
        const mode = await this.getMode();
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits.ThermostatModeType.OFF:
                return null;
            case Traits.ThermostatModeType.HEAT:
            case Traits.ThermostatModeType.COOL:
            case Traits.ThermostatModeType.HEATCOOL:
                const trait = await this.getTrait(Traits.Constants.ThermostatTemperatureSetpoint);
                return {
                    heat: trait === null || trait === void 0 ? void 0 : trait.heatCelsius,
                    cool: trait === null || trait === void 0 ? void 0 : trait.coolCelsius
                };
        }
    }
    async setMode(mode) {
        const currentMode = await this.getMode();
        if (!(currentMode === null || currentMode === void 0 ? void 0 : currentMode.availableModes.includes(mode))) {
            throw new Error(`Thermostat does not support ${mode} mode.`);
        }
        if (mode !== Traits.ThermostatModeType.OFF) {
            await this.ensureEcoOff();
        }
        if (currentMode.mode !== mode) {
            await this.executeCommand(Commands.Constants.ThermostatMode_SetMode, { mode }, true);
            currentMode.mode = mode;
        }
    }
    async getTemperatureUnits() {
        const settings = await this.getTrait(Traits.Constants.Settings);
        return settings === null || settings === void 0 ? void 0 : settings.temperatureScale;
    }
    async getRelativeHumitity() {
        const humidity = await this.getTrait(Traits.Constants.Humidity);
        return humidity === null || humidity === void 0 ? void 0 : humidity.ambientHumidityPercent;
    }
    async setEco(mode) {
        var _a, _b;
        await this.executeCommand(Commands.Constants.ThermostatEco_SetMode, { mode }, true);
        const eco = (_b = (_a = this.device) === null || _a === void 0 ? void 0 : _a.traits) === null || _b === void 0 ? void 0 : _b[Traits.Constants.ThermostatEco];
        if (eco) {
            eco.mode = mode;
        }
    }
    async setFan(timerMode, duration) {
        await this.executeCommand(Commands.Constants.ThermostatFan_SetTimer, {
            timerMode: timerMode,
            duration: duration + 's'
        });
    }
}
exports.Thermostat = Thermostat;
//# sourceMappingURL=Thermostat.js.map