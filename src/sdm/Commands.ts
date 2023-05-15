import * as Traits from './Traits';

export enum Constants {
    ThermostatTemperatureSetpoint_SetHeat = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat',
    ThermostatTemperatureSetpoint_SetCool = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool',
    ThermostatTemperatureSetpoint_SetRange = 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange',
    ThermostatMode_SetMode = 'sdm.devices.commands.ThermostatMode.SetMode',
    ThermostatEco_SetMode = 'sdm.devices.commands.ThermostatEco.SetMode',
    ThermostatFan_SetTimer = 'sdm.devices.commands.Fan.SetTimer',
    CameraLiveStream_GenerateRtspStream = 'sdm.devices.commands.CameraLiveStream.GenerateRtspStream',
    CameraLiveStream_StopRtspStream = 'sdm.devices.commands.CameraLiveStream.StopRtspStream',
    CameraLiveStream_GenerateWebRtcStream = 'sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream',
    CameraLiveStream_StopWebRtcStream = 'sdm.devices.commands.CameraLiveStream.StopWebRtcStream',
    CameraEventImage_GenerateImage = 'sdm.devices.commands.CameraEventImage.GenerateImage'
}

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
    mode: Traits.ThermostatModeType;
}

export interface ThermostatEco_SetMode {
    mode: Traits.EcoModeType;
}

export interface ThermostatFan_SetTimer {
    timerMode: Traits.FanTimerModeType,
    duration?: string;
}

export interface CameraEventImage_GenerateImage {
    eventId: string;
}

export interface CameraLiveStream_StopRtspStream {
    streamExtensionToken: string;
}

export interface CameraLiveStream_GenerateWebRtcStream {
    offerSdp: string;
}

export interface CameraLiveStream_StopWebRtcStream {
    mediaSessionId: string;
}
