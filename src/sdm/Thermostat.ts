import _ from 'lodash';
import {Device} from "./Device";
import * as Traits from "./Traits";
import * as Commands from "./Commands";
import * as Events from './Events';

export class Thermostat extends Device {

    getDisplayName(): string {
        return this.displayName ? this.displayName + ' Thermostat' : 'Unknown';
    }

    onTemperatureChanged: ((temperature: number) => void) | undefined;
    onTemperatureUnitsChanged: ((scale: Traits.TemperatureScale) => void) | undefined;
    onModeChanged: ((mode: Traits.ThermostatModeType) => void) | undefined;
    onTargetTemperatureChanged: ((temperature: number) => void) | undefined;
    onHvacChanged: ((status: Traits.HvacStatusType) => void) | undefined;
    onHumidityChanged: ((humidity: number) => void) | undefined;

    event(event: Events.ResourceTraitEvent) {
        super.event(event);
        _.forEach(event.resourceUpdate.traits, (value, key) => {
            switch (key) {
                case Traits.Constants.ThermostatTemperatureSetpoint:
                    if (this.onTargetTemperatureChanged) {
                        // @ts-ignore
                        this.getTargetTemperature().then(targetTemperature => this.onTargetTemperatureChanged(targetTemperature));
                    }
                    break;
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
            }
        })
    }

    async getEco(): Promise<Traits.ThermostatEco | null> {
        return await this.getTrait<Traits.ThermostatEco>(Traits.Constants.ThermostatEco);
    }

    async getMode(): Promise<Traits.ThermostatMode | null> {
        return await this.getTrait<Traits.ThermostatMode>(Traits.Constants.ThermostatMode);
    }

    async getHvac(): Promise<Traits.ThermostatHvac | null> {
        return await this.getTrait<Traits.ThermostatHvac>(Traits.Constants.ThermostatHvac);}

    async getTemperature(): Promise<number | undefined> {
        const trait =  await this.getTrait<Traits.Temperature>(Traits.Constants.Temperature);
        return trait?.ambientTemperatureCelsius;
    }

    async getTargetTemperature(): Promise<number | undefined> {

        const eco = await this.getEco();

        if (eco?.mode !== Traits.EcoModeType.OFF) {
            //Homebridge always requires a set temperature, even if the thermostat is off
            return eco?.heatCelsius;
        }

        const trait =  await this.getTrait<Traits.ThermostatTemperatureSetpoint>(Traits.Constants.ThermostatTemperatureSetpoint);
        const mode = await this.getMode();

        switch (mode?.mode) {
            case Traits.ThermostatModeType.OFF:
                //Homebridge always requires a set temperature, even if the thermostat is off
                return await this.getTemperature();
            case Traits.ThermostatModeType.HEAT:
                return trait?.heatCelsius;
            case Traits.ThermostatModeType.COOL:
                return trait?.coolCelsius;
            case Traits.ThermostatModeType.HEATCOOL:
                //todo: not sure what to return here
                return trait?.heatCelsius;
        }
    }

    async setTemperature(temperature:number): Promise<void> {
        const eco = await this.getEco();

        if (eco?.mode !== Traits.EcoModeType.OFF)
            return undefined;

        const mode = await this.getMode();

        switch (mode?.mode) {
            case Traits.ThermostatModeType.HEAT:
                await this.executeCommand<Commands.ThermostatTemperatureSetpoint_SetHeat, void>(Commands.Constants.ThermostatTemperatureSetpoint_SetHeat, {
                    heatCelsius: temperature
                });
                break;
            case Traits.ThermostatModeType.COOL:
                await this.executeCommand<Commands.ThermostatTemperatureSetpoint_SetCool, void>(Commands.Constants.ThermostatTemperatureSetpoint_SetCool, {
                    coolCelsius: temperature
                });
                break;
            case Traits.ThermostatModeType.HEATCOOL:
                this.log.error('Setting a target temperature when the thermostat is in auto mode is not supported at this time.  The plugin author is looking into it.');
                // await this.executeCommand<Commands.ThermostatTemperatureSetpoint_SetRange, void>(Commands.Constants.ThermostatTemperatureSetpoint_SetRange, {
                //     heatCelsius: temperature,
                //     coolCelsius: temperature
                // });
                break;
        }
    }

    async setMode(mode:Traits.ThermostatModeType): Promise<void> {
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
}
