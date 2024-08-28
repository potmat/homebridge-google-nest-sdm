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
    event(event) {
        super.event(event);
        lodash_1.default.forEach(event.resourceUpdate.traits, (value, key) => {
            switch (key) {
                case Traits.Constants.ThermostatTemperatureSetpoint:
                    const setpoint = event.resourceUpdate.traits[Traits.Constants.ThermostatTemperatureSetpoint];
                    if (!setpoint.coolCelsius && !setpoint.heatCelsius)
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
                                    if (this.onTargetTemperatureChanged && targetTemperature)
                                        this.onTargetTemperatureChanged(targetTemperature);
                                });
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
        if ((eco === null || eco === void 0 ? void 0 : eco.mode) !== Traits.EcoModeType.OFF) {
            throw new Error('Cannot get target temperature when the thermostat is in eco mode.');
        }
        const trait = await this.getTrait(Traits.Constants.ThermostatTemperatureSetpoint);
        const mode = await this.getMode();
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot get a target temperature when the thermostat is off.');
            case Traits.ThermostatModeType.HEAT:
                return trait === null || trait === void 0 ? void 0 : trait.heatCelsius;
            case Traits.ThermostatModeType.COOL:
                return trait === null || trait === void 0 ? void 0 : trait.coolCelsius;
            case Traits.ThermostatModeType.HEATCOOL:
                throw new Error('Cannot get a target temperature when the thermostat is in auto mode.');
        }
    }
    async setTargetTemperature(temperature) {
        const eco = await this.getEco();
        if ((eco === null || eco === void 0 ? void 0 : eco.mode) !== Traits.EcoModeType.OFF) {
            throw new Error('Cannot set a target temperature when the thermostat is in eco mode.');
        }
        const mode = await this.getMode();
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits.ThermostatModeType.HEAT:
                await this.executeIdempotentCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetHeat, {
                    heatCelsius: temperature
                });
                break;
            case Traits.ThermostatModeType.COOL:
                await this.executeIdempotentCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetCool, {
                    coolCelsius: temperature
                });
                break;
            case Traits.ThermostatModeType.HEATCOOL:
                throw new Error('Cannot set a target temperature when the thermostat is in auto mode.');
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot set a target temperature when the thermostat is off.');
        }
    }
    async setTargetTemperatureRange(cool, heat) {
        const eco = await this.getEco();
        if ((eco === null || eco === void 0 ? void 0 : eco.mode) !== Traits.EcoModeType.OFF) {
            throw new Error('Cannot set a target temperature when the thermostat is in eco mode.');
        }
        if (!cool && !heat) {
            throw new Error('At least one of heat/cool must be specified when setting a target temperature range.');
        }
        const mode = await this.getMode();
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits.ThermostatModeType.HEATCOOL:
                const currentRange = await this.getTargetTemperatureRange();
                await this.executeIdempotentCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetRange, {
                    heatCelsius: heat || (currentRange === null || currentRange === void 0 ? void 0 : currentRange.heat),
                    coolCelsius: cool || (currentRange === null || currentRange === void 0 ? void 0 : currentRange.cool)
                });
                break;
            case Traits.ThermostatModeType.HEAT:
                if (!heat)
                    throw new Error('Cannot set a target temperature range (heat only) when the thermostat is not in heat mode.');
                await this.executeIdempotentCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetRange, {
                    heatCelsius: heat
                });
            case Traits.ThermostatModeType.COOL:
                if (!cool)
                    throw new Error('Cannot set a target temperature range (cool only) when the thermostat is not in cool mode.');
                await this.executeIdempotentCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetRange, {
                    coolCelsius: cool
                });
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot set a target temperature when the thermostat is off.');
        }
    }
    async getTargetTemperatureRange() {
        const eco = await this.getEco();
        if ((eco === null || eco === void 0 ? void 0 : eco.mode) !== Traits.EcoModeType.OFF) {
            return {
                heat: eco === null || eco === void 0 ? void 0 : eco.heatCelsius,
                cool: eco === null || eco === void 0 ? void 0 : eco.coolCelsius
            };
        }
        const mode = await this.getMode();
        switch (mode === null || mode === void 0 ? void 0 : mode.mode) {
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot get a target temperature range when the thermostat is in off.');
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
        await this.executeCommand(Commands.Constants.ThermostatMode_SetMode, {
            mode: mode
        });
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
        await this.executeCommand(Commands.Constants.ThermostatEco_SetMode, {
            mode: mode
        });
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