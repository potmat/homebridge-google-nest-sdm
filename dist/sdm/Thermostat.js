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
const Commands = __importStar(require("./Commands"));
class Thermostat extends Device_1.Device {
    async convertToFahrenheitIfNecessary(input) {
        if (!input)
            return input;
        const unit = await this.getTemperatureUnits();
        if (unit === Traits.TemperatureScale.FAHRENHEIT)
            return (input * (9 / 5)) + 32;
        return input;
    }
    async convertToCelsiusIfNecessary(input) {
        if (!input)
            return input;
        const unit = await this.getTemperatureUnits();
        if (unit === Traits.TemperatureScale.CELSIUS)
            return (input - 32) * (5 / 9);
        return input;
    }
    getDisplayName() {
        return this.displayName ? this.displayName + ' Thermostat' : 'Unknown';
    }
    event(event) {
        super.event(event);
        lodash_1.default.forEach(event.resourceUpdate.traits, (value, key) => {
            switch (key) {
                case Traits.Constants.ThermostatTemperatureSetpoint:
                    if (this.onTargetTemperatureChanged) {
                        const traitValue = value;
                        const target = traitValue.heatCelsius ? traitValue.heatCelsius : traitValue.coolCelsius;
                        this.onTargetTemperatureChanged(target);
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
            }
        });
    }
    async getEco() {
        const trait = await this.getTrait(Traits.Constants.ThermostatEco);
        return trait === null || trait === void 0 ? void 0 : trait.mode;
    }
    async getMode() {
        const trait = await this.getTrait(Traits.Constants.ThermostatMode);
        return trait === null || trait === void 0 ? void 0 : trait.mode;
    }
    async getHvac() {
        const trait = await this.getTrait(Traits.Constants.ThermostatHvac);
        return trait === null || trait === void 0 ? void 0 : trait.status;
    }
    async getTemperature() {
        const trait = await this.getTrait(Traits.Constants.Temperature);
        return this.convertToFahrenheitIfNecessary(trait === null || trait === void 0 ? void 0 : trait.ambientTemperatureCelsius);
    }
    async getTargetTemperature() {
        const eco = await this.getEco();
        if (eco !== Traits.EcoModeType.OFF)
            return Promise.resolve(undefined);
        const trait = await this.getTrait(Traits.Constants.ThermostatTemperatureSetpoint);
        const mode = await this.getMode();
        switch (mode) {
            case Traits.ThermostatModeType.OFF:
                return Promise.resolve(undefined);
            case Traits.ThermostatModeType.HEAT:
                return this.convertToFahrenheitIfNecessary(trait === null || trait === void 0 ? void 0 : trait.heatCelsius);
            case Traits.ThermostatModeType.COOL:
                return this.convertToFahrenheitIfNecessary(trait === null || trait === void 0 ? void 0 : trait.coolCelsius);
            case Traits.ThermostatModeType.HEATCOOL:
                //todo: what to return here?
                return undefined;
        }
    }
    async setTemperature(temperature) {
        const eco = await this.getEco();
        if (eco !== Traits.EcoModeType.OFF)
            return undefined;
        const mode = await this.getMode();
        const temperatureCelsius = await this.convertToCelsiusIfNecessary(temperature);
        switch (mode) {
            case Traits.ThermostatModeType.HEAT:
                await this.executeCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetHeat, {
                    heatCelsius: temperatureCelsius
                });
                break;
            case Traits.ThermostatModeType.COOL:
                await this.executeCommand(Commands.Constants.ThermostatTemperatureSetpoint_SetCool, {
                    coolCelsius: temperatureCelsius
                });
                break;
            //todo: what to do here?
            // case Traits.ThermostatModeType.HEATCOOL:
        }
    }
    async setMode(mode) {
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
}
exports.Thermostat = Thermostat;
//# sourceMappingURL=Thermostat.js.map