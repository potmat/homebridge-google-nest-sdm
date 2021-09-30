export interface ThermostatTemperatureSetpoint {
    heatCelsius?: number;
    coolCelsius?: number;
}

export interface ThermostatMode {
    availableModes: string[];
    mode: string;
}

export interface Hvac {
    status: string;
}

export interface Temperature {
    ambientTemperatureCelsius: number;
}

export interface ThermostatEco {
    availableModes: string[];
    mode: string;
    heatCelsius: number;
    coolCelsius: number;
}

export interface Settings {
    temparatureScale: string;
}

export interface Humidity {
    ambientHumidityPercent: number;
}
