import {Device} from "./Device";
import * as Traits from "./Traits";
import * as Commands from "./Commands";

export class Thermostat extends Device {

    async getEco(): Promise<string> {
        const trait =  await this.getTrait<Traits.ThermostatEco>('sdm.devices.traits.ThermostatEco');
        return trait.mode;
    }

    async getMode(): Promise<string> {
        const trait =  await this.getTrait<Traits.ThermostatMode>('sdm.devices.traits.ThermostatMode');
        return trait.mode;
    }

    async getHvac(): Promise<string> {
        const trait =  await this.getTrait<Traits.Hvac>('sdm.devices.traits.ThermostatHvac');
        return trait.status;
    }

    async getTemparature(): Promise<number> {
        const trait =  await this.getTrait<Traits.Temperature>('sdm.devices.traits.Temperature');
        return trait.ambientTemperatureCelsius;
    }

    async getTargetTemparature(): Promise<number|undefined> {

        const eco = await this.getEco();

        if (eco !== 'OFF')
            return Promise.resolve(undefined);

        const trait =  await this.getTrait<Traits.ThermostatTemperatureSetpoint>('sdm.devices.traits.ThermostatTemperatureSetpoint');
        const mode = await this.getMode();

        switch (mode) {
            case 'OFF':
                return Promise.resolve(undefined);
            case 'HEAT':
                return trait.heatCelsius;
            case 'COOL':
                return trait.coolCelsius;
            case 'HEATCOOL':
                //todo: what to return here?
                return Promise.resolve(undefined);
        }

    }

    async setTemparature(temparature:number): Promise<void> {
        const eco = await this.getEco();

        if (eco !== 'OFF')
            return Promise.resolve(undefined);

        const mode = await this.getMode();

        switch (mode) {
            case 'HEAT':
                await this.executeCommand<Commands.ThermostatTemperatureSetpoint_SetHeat, void>("sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat", {
                    heatCelsius: temparature
                });
            case 'COOL':
                await this.executeCommand<Commands.ThermostatTemperatureSetpoint_SetCool, void>("sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool", {
                    coolCelsius: temparature
                });
            case 'HEATCOOL':
                //todo: what to do here?
                return Promise.resolve(undefined);
        }
    }

    async setMode(mode:string): Promise<void> {
        await this.executeCommand<Commands.ThermostatMode_SetMode, void>("sdm.devices.commands.ThermostatMode.SetMode", {
            mode: mode
        });
    }

    async getTemparatureUnits(): Promise<string> {
        const settings = await this.getTrait<Traits.Settings>("sdm.devices.traits.Settings");
        return settings.temparatureScale;
    }

    async getRelativeHumitity(): Promise<number> {
        const humidity = await this.getTrait<Traits.Humidity>("sdm.devices.traits.Humidity");
        return humidity.ambientHumidityPercent;
    }
}
