"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProtocolType = exports.AudioCodecType = exports.VideoCodecType = exports.TemperatureScale = exports.EcoModeType = exports.HvacStatusType = exports.ThermostatModeType = exports.FanTimerModeType = exports.ConnectivityStatusType = exports.Constants = void 0;
var Constants;
(function (Constants) {
    Constants["Info"] = "sdm.devices.traits.Info";
    Constants["Connectivity"] = "sdm.devices.traits.Connectivity";
    Constants["Fan"] = "sdm.devices.traits.Fan";
    Constants["Humidity"] = "sdm.devices.traits.Humidity";
    Constants["ThermostatTemperatureSetpoint"] = "sdm.devices.traits.ThermostatTemperatureSetpoint";
    Constants["ThermostatMode"] = "sdm.devices.traits.ThermostatMode";
    Constants["ThermostatHvac"] = "sdm.devices.traits.ThermostatHvac";
    Constants["Temperature"] = "sdm.devices.traits.Temperature";
    Constants["ThermostatEco"] = "sdm.devices.traits.ThermostatEco";
    Constants["Settings"] = "sdm.devices.traits.Settings";
    Constants["CameraImage"] = "sdm.devices.traits.CameraImage";
    Constants["CameraLiveStream"] = "sdm.devices.traits.CameraLiveStream";
})(Constants = exports.Constants || (exports.Constants = {}));
var ConnectivityStatusType;
(function (ConnectivityStatusType) {
    ConnectivityStatusType["ONLINE"] = "ONLINE";
    ConnectivityStatusType["OFFLINE"] = "OFFLINE";
})(ConnectivityStatusType = exports.ConnectivityStatusType || (exports.ConnectivityStatusType = {}));
var FanTimerModeType;
(function (FanTimerModeType) {
    FanTimerModeType["ON"] = "ON";
    FanTimerModeType["OFF"] = "OFF";
})(FanTimerModeType = exports.FanTimerModeType || (exports.FanTimerModeType = {}));
var ThermostatModeType;
(function (ThermostatModeType) {
    ThermostatModeType["HEAT"] = "HEAT";
    ThermostatModeType["COOL"] = "COOL";
    ThermostatModeType["HEATCOOL"] = "HEATCOOL";
    ThermostatModeType["OFF"] = "OFF";
})(ThermostatModeType = exports.ThermostatModeType || (exports.ThermostatModeType = {}));
var HvacStatusType;
(function (HvacStatusType) {
    HvacStatusType["OFF"] = "OFF";
    HvacStatusType["HEATING"] = "HEATING";
    HvacStatusType["COOLING"] = "COOLING";
})(HvacStatusType = exports.HvacStatusType || (exports.HvacStatusType = {}));
var EcoModeType;
(function (EcoModeType) {
    EcoModeType["MANUAL_ECO"] = "MANUAL_ECO";
    EcoModeType["OFF"] = "OFF";
})(EcoModeType = exports.EcoModeType || (exports.EcoModeType = {}));
var TemperatureScale;
(function (TemperatureScale) {
    TemperatureScale["CELSIUS"] = "CELSIUS";
    TemperatureScale["FAHRENHEIT"] = "FAHRENHEIT";
})(TemperatureScale = exports.TemperatureScale || (exports.TemperatureScale = {}));
var VideoCodecType;
(function (VideoCodecType) {
    VideoCodecType["H264"] = "H264";
})(VideoCodecType = exports.VideoCodecType || (exports.VideoCodecType = {}));
var AudioCodecType;
(function (AudioCodecType) {
    AudioCodecType["AAC"] = "AAC";
})(AudioCodecType = exports.AudioCodecType || (exports.AudioCodecType = {}));
var ProtocolType;
(function (ProtocolType) {
    ProtocolType["RTSP"] = "RTSP";
    ProtocolType["WEB_RTC"] = "WEB_RTC";
})(ProtocolType = exports.ProtocolType || (exports.ProtocolType = {}));
//# sourceMappingURL=Traits.js.map