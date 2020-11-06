"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = __importDefault(require("lodash"));
const google = __importStar(require("googleapis"));
class Device {
    constructor(smartdevicemanagement, device) {
        this.smartdevicemanagement = smartdevicemanagement;
        this.device = device;
        this.lastRefresh = Date.now();
        const parent = lodash_1.default.find(device.parentRelations, relation => relation.displayName);
        this.displayName = parent === null || parent === void 0 ? void 0 : parent.displayName;
    }
    getName() {
        return this.device.name;
    }
    getDisplayName() {
        return this.displayName ? this.displayName : 'Unknown Camera';
    }
    async refresh() {
        this.smartdevicemanagement.enterprises.devices.get({ name: this.getName() })
            .then(response => {
            this.device = response.data;
            this.lastRefresh = Date.now();
        });
    }
    async getTrait(name) {
        var _a, _b;
        const howLongAgo = Date.now() - this.lastRefresh;
        if (howLongAgo > 10000)
            await this.refresh();
        return (_b = (_a = this.device) === null || _a === void 0 ? void 0 : _a.traits) === null || _b === void 0 ? void 0 : _b.name;
    }
}
exports.Device = Device;
class Camera extends Device {
    getSnapshot() {
        return null;
    }
    getResolutions() {
        return [[1920, 1080, 15]];
    }
    async getStreamInfo() {
        return this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.getName(),
            requestBody: {
                command: 'sdm.devices.commands.CameraLiveStream.GenerateRtspStream'
            }
        }).then(response => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            return {
                rtspUrl: (_c = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.results) === null || _b === void 0 ? void 0 : _b.streamUrls) === null || _c === void 0 ? void 0 : _c.rtspUrl,
                token: (_e = (_d = response.data) === null || _d === void 0 ? void 0 : _d.results) === null || _e === void 0 ? void 0 : _e.streamToken,
                extensionToken: (_g = (_f = response.data) === null || _f === void 0 ? void 0 : _f.results) === null || _g === void 0 ? void 0 : _g.streamExtensionToken,
                expiresAt: new Date((_j = (_h = response.data) === null || _h === void 0 ? void 0 : _h.results) === null || _j === void 0 ? void 0 : _j.expiresAt)
            };
        });
    }
    async stopStream(extensionToken) {
        return this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.getName(),
            requestBody: {
                command: 'sdm.devices.commands.CameraLiveStream.StopRtspStream',
                params: {
                    streamExtensionToken: extensionToken
                }
            }
        }).then(response => {
            var _a, _b, _c;
            return (_c = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.results) === null || _b === void 0 ? void 0 : _b.streamUrls) === null || _c === void 0 ? void 0 : _c.rtspUrl;
        });
    }
}
exports.Camera = Camera;
class Doorbell extends Camera {
    getResolutions() {
        return [[1600, 1200, 15]];
    }
}
exports.Doorbell = Doorbell;
class Thermostat extends Device {
    async getTemparature() {
        const trait = await this.getTrait('sdm.devices.traits.Temperature');
        return trait.ambientTemperatureCelsius;
    }
}
exports.Thermostat = Thermostat;
class UnknownDevice extends Device {
}
exports.UnknownDevice = UnknownDevice;
class SmartDeviceManagement {
    constructor(config) {
        this.oauth2Client = new google.Auth.OAuth2Client(config.clientId, config.clientSecret);
        this.projectId = config.projectId;
        this.oauth2Client.setCredentials({
            refresh_token: config.refreshToken
        });
        this.smartdevicemanagement = new google.smartdevicemanagement_v1.Smartdevicemanagement({
            auth: this.oauth2Client
        });
    }
    async list_devices() {
        return this.smartdevicemanagement.enterprises.devices.list({ parent: `enterprises/${this.projectId}` })
            .then(response => {
            return lodash_1.default(response.data.devices)
                .filter(device => device.name !== null)
                .map(device => {
                switch (device.type) {
                    case 'sdm.devices.types.DOORBELL':
                        return new Doorbell(this.smartdevicemanagement, device);
                    case 'sdm.devices.types.CAMERA':
                        return new Camera(this.smartdevicemanagement, device);
                    case 'sdm.devices.types.THERMOSTAT':
                        return new Thermostat(this.smartdevicemanagement, device);
                    default:
                        return new UnknownDevice(this.smartdevicemanagement, device);
                }
            })
                .value();
        });
    }
}
exports.SmartDeviceManagement = SmartDeviceManagement;
//# sourceMappingURL=SdmApi.js.map