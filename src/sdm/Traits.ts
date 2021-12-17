export enum Constants {
    Info = 'sdm.devices.traits.Info',
    Connectivity = 'sdm.devices.traits.Connectivity',
    Fan = 'sdm.devices.traits.Fan',
    Humidity = 'sdm.devices.traits.Humidity',
    ThermostatTemperatureSetpoint = 'sdm.devices.traits.ThermostatTemperatureSetpoint',
    ThermostatMode = 'sdm.devices.traits.ThermostatMode',
    ThermostatHvac = 'sdm.devices.traits.ThermostatHvac',
    Temperature = 'sdm.devices.traits.Temperature',
    ThermostatEco = 'sdm.devices.traits.ThermostatEco',
    Settings = 'sdm.devices.traits.Settings',
    CameraImage = 'sdm.devices.traits.CameraImage',
    CameraLiveStream = 'sdm.devices.traits.CameraLiveStream',
}

export interface Info {
    customName: string;
}

export enum ConnectivityStatusType {
    ONLINE = 'ONLINE',
    OFFLINE = 'OFFLINE'
}

export interface Connectivity {
    status: ConnectivityStatusType;
}

export enum FanTimerModeType {
    ON = 'ON',
    OFF = 'OFF'
}

export interface Fan {
    timerMode: FanTimerModeType,
    timerTimeout: string;
}

export interface Humidity {
    ambientHumidityPercent: number;
}

export interface ThermostatTemperatureSetpoint {
    heatCelsius?: number;
    coolCelsius?: number;
}

export enum ThermostatModeType {
    HEAT = 'HEAT',
    COOL = 'COOL',
    HEATCOOL = 'HEATCOOL',
    OFF = 'OFF'
}

export interface ThermostatMode {
    availableModes: ThermostatModeType[];
    mode: ThermostatModeType;
}

export enum HvacStatusType {
    OFF = 'OFF',
    HEATING = 'HEATING',
    COOLING = 'COOLING'
}

export interface ThermostatHvac {
    status: HvacStatusType;
}

export interface Temperature {
    ambientTemperatureCelsius: number;
}

export enum EcoModeType {
    MANUAL_ECO = 'MANUAL_ECO',
    OFF = 'OFF'
}

export interface ThermostatEco {
    availableModes: EcoModeType[];
    mode: EcoModeType;
    heatCelsius: number;
    coolCelsius: number;
}

export enum TemperatureScale {
    CELSIUS = 'CELSIUS',
    FAHRENHEIT = 'FAHRENHEIT'
}

export interface Settings {
    temperatureScale?: TemperatureScale;
}

export interface ImageResolution {
    width: number;
    height: number;
}

export interface CameraImage {
    maxImageResolution: ImageResolution;
}

export enum VideoCodecType {
    H264 = 'H264'
}

export enum AudioCodecType {
    AAC = 'AAC'
}

export enum ProtocolType {
    RTSP = 'RTSP',
    WEB_RTC = 'WEB_RTC'
}

export interface CameraLiveStream {
    maxImageResolution: ImageResolution;
    videoCodecs: VideoCodecType[];
    audioCodecs: AudioCodecType[];
    supportedProtocols: ProtocolType[];
}
