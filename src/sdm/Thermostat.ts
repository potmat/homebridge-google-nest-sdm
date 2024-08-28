import _ from 'lodash';
import {Device} from "./Device";
import * as Traits from "./Traits";
import {EcoModeType, FanTimerModeType, ThermostatModeType} from "./Traits";
import {TemperatureRange} from './Types';
import * as Commands from "./Commands";
import * as Events from './Events';

export class Thermostat extends Device {

    getDisplayName(): string {
        return this.displayName ? this.displayName + ' Thermostat' : 'Unknown';
    }

    onTemperatureChanged: ((temperature: number) => void) | undefined;
    onTemperatureUnitsChanged: ((scale: Traits.TemperatureScale) => void) | undefined;
    onModeChanged: ((mode: Traits.ThermostatModeType) => void) | undefined;
    onEcoChanged: ((mode: Traits.ThermostatEco) => void) | undefined;
    onFanChanged: ((mode: Traits.Fan) => void) | undefined;
    onTargetTemperatureChanged: ((temperature: number) => void) | undefined;
    onTargetTemperatureRangeChanged: ((range: TemperatureRange) => void) | undefined;
    onHvacChanged: ((status: Traits.HvacStatusType) => void) | undefined;
    onHumidityChanged: ((humidity: number) => void) | undefined;

    event(event: Events.ResourceTraitEvent) {
        super.event(event);
        _.forEach(event.resourceUpdate.traits, (value, key) => {
            switch (key) {
                case Traits.Constants.ThermostatTemperatureSetpoint:
                    const setpoint = <Traits.ThermostatTemperatureSetpoint>event.resourceUpdate.traits[Traits.Constants.ThermostatTemperatureSetpoint];

                    if (!setpoint.coolCelsius && !setpoint.heatCelsius)
                        return;

                    this.getMode()
                        .then(mode => {
                            switch (mode?.mode) {
                                case ThermostatModeType.HEATCOOL:
                                    this.getTargetTemperatureRange().then(targetTemperatureRange => {
                                        if (this.onTargetTemperatureRangeChanged && targetTemperatureRange)
                                            this.onTargetTemperatureRangeChanged(targetTemperatureRange);
                                    });
                                    break;
                                case ThermostatModeType.HEAT:
                                case ThermostatModeType.COOL:
                                    this.getTargetTemperature().then(targetTemperature => {
                                        if (this.onTargetTemperatureChanged && targetTemperature)
                                            this.onTargetTemperatureChanged(targetTemperature);
                                    });
                            }
                        });
                    break;
                case Traits.Constants.ThermostatEco:
                    if (this.onEcoChanged) {
                        const traitValue = value as Traits.ThermostatEco;
                        this.onEcoChanged(traitValue);
                    }
                    break;
                case Traits.Constants.Fan:
                    if (this.onFanChanged) {
                        const traitValue = value as Traits.Fan;
                        this.onFanChanged(traitValue);
                    }
                case Traits.Constants.ThermostatHvac:
                    if (this.onHvacChanged) {
                        const traitValue = value as Traits.ThermostatHvac;
                        this.onHvacChanged(traitValue.status);
                    }
                    break;
                case Traits.Constants.Humidity:
                    if (this.onHumidityChanged) {
                        const traitVale = value as Traits.Humidity;
                        this.onHumidityChanged(traitVale.ambientHumidityPercent);
                    }
                    break;
                case Traits.Constants.ThermostatMode:
                    if (this.onModeChanged) {
                        const traitVale = value as Traits.ThermostatMode;
                        this.onModeChanged(traitVale.mode);
                    }
                    break;
                case Traits.Constants.Temperature:
                    if (this.onTemperatureChanged) {
                        const traitVale = value as Traits.Temperature;
                        this.onTemperatureChanged(traitVale.ambientTemperatureCelsius);
                    }
                    break;
                case Traits.Constants.Settings:
                    if (this.onTemperatureUnitsChanged) {
                        const traitVale = value as Traits.Settings;
                        this.onTemperatureUnitsChanged(traitVale.temperatureScale!);
                    }
                    break;
                default:
                    break;
            }
        })
    }

    async getEco(): Promise<Traits.ThermostatEco | null> {
        return await this.getTrait<Traits.ThermostatEco>(Traits.Constants.ThermostatEco);
    }

    async getFan(): Promise<Traits.Fan | null> {
        return await this.getTrait<Traits.Fan>(Traits.Constants.Fan);
    }

    async getMode(): Promise<Traits.ThermostatMode | null> {
        return await this.getTrait<Traits.ThermostatMode>(Traits.Constants.ThermostatMode);
    }

    async getHvac(): Promise<Traits.ThermostatHvac | null> {
        return await this.getTrait<Traits.ThermostatHvac>(Traits.Constants.ThermostatHvac);
    }

    async getTemperature(): Promise<number | undefined> {
        const trait = await this.getTrait<Traits.Temperature>(Traits.Constants.Temperature);
        return trait?.ambientTemperatureCelsius;
    }

    async getTargetTemperature(): Promise<number | undefined> {

        const eco = await this.getEco();

        if (eco?.mode !== Traits.EcoModeType.OFF) {
            throw new Error('Cannot get target temperature when the thermostat is in eco mode.');
        }

        const trait = await this.getTrait<Traits.ThermostatTemperatureSetpoint>(Traits.Constants.ThermostatTemperatureSetpoint);
        const mode = await this.getMode();

        switch (mode?.mode) {
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot get a target temperature when the thermostat is off.');
            case Traits.ThermostatModeType.HEAT:
                return trait?.heatCelsius;
            case Traits.ThermostatModeType.COOL:
                return trait?.coolCelsius;
            case Traits.ThermostatModeType.HEATCOOL:
                throw new Error('Cannot get a target temperature when the thermostat is in auto mode.');
        }
    }

    async setTargetTemperature(temperature: number): Promise<void> {
        const eco = await this.getEco();

        if (eco?.mode !== Traits.EcoModeType.OFF) {
            throw new Error('Cannot set a target temperature when the thermostat is in eco mode.');
        }

        const mode = await this.getMode();

        switch (mode?.mode) {
            case Traits.ThermostatModeType.HEAT:
                await this.executeIdempotentCommand<Commands.ThermostatTemperatureSetpoint_SetHeat, void>(Commands.Constants.ThermostatTemperatureSetpoint_SetHeat, {
                    heatCelsius: temperature
                });
                break;
            case Traits.ThermostatModeType.COOL:
                await this.executeIdempotentCommand<Commands.ThermostatTemperatureSetpoint_SetCool, void>(Commands.Constants.ThermostatTemperatureSetpoint_SetCool, {
                    coolCelsius: temperature
                });
                break;
            case Traits.ThermostatModeType.HEATCOOL:
                throw new Error('Cannot set a target temperature when the thermostat is in auto mode.');
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot set a target temperature when the thermostat is off.');
        }
    }

    async setTargetTemperatureRange(cool?: number, heat?: number): Promise<void> {
        const eco = await this.getEco();

        if (eco?.mode !== Traits.EcoModeType.OFF) {
            throw new Error('Cannot set a target temperature when the thermostat is in eco mode.');
        }

        if (!cool && !heat) {
            throw new Error('At least one of heat/cool must be specified when setting a target temperature range.');
        }

        const mode = await this.getMode();

        switch (mode?.mode) {
            case Traits.ThermostatModeType.HEATCOOL:
                const currentRange = await this.getTargetTemperatureRange();
                await this.executeIdempotentCommand<Commands.ThermostatTemperatureSetpoint_SetRange, void>(Commands.Constants.ThermostatTemperatureSetpoint_SetRange, {
                    heatCelsius: heat || currentRange?.heat!,
                    coolCelsius: cool || currentRange?.cool!
                });
                break;
            case Traits.ThermostatModeType.HEAT:
                if (!heat)
                    throw new Error('Cannot set a target temperature range (heat only) when the thermostat is not in heat mode.');
                await this.executeIdempotentCommand<Commands.ThermostatTemperatureSetpoint_SetHeat, void>(Commands.Constants.ThermostatTemperatureSetpoint_SetRange, {
                    heatCelsius: heat
                });
            case Traits.ThermostatModeType.COOL:
                if (!cool)
                    throw new Error('Cannot set a target temperature range (cool only) when the thermostat is not in cool mode.');
                await this.executeIdempotentCommand<Commands.ThermostatTemperatureSetpoint_SetCool, void>(Commands.Constants.ThermostatTemperatureSetpoint_SetRange, {
                    coolCelsius: cool
                });
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot set a target temperature when the thermostat is off.');
        }
    }

    async getTargetTemperatureRange(): Promise<TemperatureRange | null | undefined> {

        const eco = await this.getEco();

        if (eco?.mode !== Traits.EcoModeType.OFF) {
            return {
                heat: eco?.heatCelsius!,
                cool: eco?.coolCelsius!
            }
        }

        const mode = await this.getMode();

        switch (mode?.mode) {
            case Traits.ThermostatModeType.OFF:
                throw new Error('Cannot get a target temperature range when the thermostat is in off.');
            case Traits.ThermostatModeType.HEAT:
            case Traits.ThermostatModeType.COOL:
            case Traits.ThermostatModeType.HEATCOOL:
                const trait = await this.getTrait<Traits.ThermostatTemperatureSetpoint>(Traits.Constants.ThermostatTemperatureSetpoint);
                return {
                    heat: trait?.heatCelsius,
                    cool: trait?.coolCelsius
                }
        }
    }

    async setMode(mode: Traits.ThermostatModeType): Promise<void> {
        const currentMode = await this.getMode()

        if (!currentMode?.availableModes.includes(mode)) {
            throw new Error(`Thermostat does not support ${mode} mode.`);
        }

        await this.executeCommand<Commands.ThermostatMode_SetMode, void>(Commands.Constants.ThermostatMode_SetMode, {
            mode: mode
        });
    }

    async getTemperatureUnits(): Promise<Traits.TemperatureScale | undefined> {
        const settings = await this.getTrait<Traits.Settings>(Traits.Constants.Settings);
        return settings?.temperatureScale;
    }

    async getRelativeHumitity(): Promise<number | undefined> {
        const humidity = await this.getTrait<Traits.Humidity>(Traits.Constants.Humidity);
        return humidity?.ambientHumidityPercent;
    }

    async setEco(mode: EcoModeType) {
        await this.executeCommand<Commands.ThermostatEco_SetMode, void>(Commands.Constants.ThermostatEco_SetMode, {
            mode: mode
        });
    }

    async setFan(timerMode: FanTimerModeType, duration?: number) {
        await this.executeCommand<Commands.ThermostatFan_SetTimer, void>(Commands.Constants.ThermostatFan_SetTimer, {
            timerMode: timerMode,
            duration: duration + 's'
        })
    }
}
