export interface ThermostatTemperatureSetpoint_SetHeat {
    heatCelsius: number;
}

export interface ThermostatTemperatureSetpoint_SetCool {
    coolCelsius: number;
}

export interface ThermostatTemperatureSetpoint_SetRange {
    heatCelsius: number;
    coolCelsius: number;
}

export interface ThermostatMode_SetMode {
    mode: string;
}
