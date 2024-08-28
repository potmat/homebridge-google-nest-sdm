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
exports.SmartDeviceManagement = void 0;
const lodash_1 = __importDefault(require("lodash"));
const google = __importStar(require("googleapis"));
const pubsub = __importStar(require("@google-cloud/pubsub"));
const Camera_1 = require("./Camera");
const Doorbell_1 = require("./Doorbell");
const Thermostat_1 = require("./Thermostat");
const UnknownDevice_1 = require("./UnknownDevice");
const Display_1 = require("./Display");
class SmartDeviceManagement {
    constructor(config, log) {
        this.subscribed = true;
        this.log = log;
        this.oauth2Client = new google.Auth.OAuth2Client(config.clientId, config.clientSecret);
        this.projectId = config.projectId;
        this.structureId = config.structureId;
        this.oauth2Client.setCredentials({
            refresh_token: config.refreshToken
        });
        this.smartdevicemanagement = new google.smartdevicemanagement_v1.Smartdevicemanagement({
            auth: this.oauth2Client
        });
        try {
            this.pubSubClient = new pubsub.PubSub({
                //use GCP project ID if it's present
                projectId: config.gcpProjectId || config.projectId,
                credentials: {
                    // @ts-ignore
                    type: 'authorized_user',
                    // @ts-ignore
                    client_id: config.clientId,
                    // @ts-ignore
                    client_secret: config.clientSecret,
                    // @ts-ignore
                    refresh_token: config.refreshToken
                }
            });
            this.subscription = this.pubSubClient.subscription(config.subscriptionId);
            this.subscription.on('message', message => {
                message.ack();
                if (!this.devices)
                    return;
                this.log.debug('Event received: ' + message.data.toString());
                const event = JSON.parse(message.data);
                // if ((event as Events.ResourceRelationEvent).relationUpdate) {
                //     const resourceRelationtEvent = event as Events.ResourceRelationEvent;
                // } else
                if (event.resourceUpdate.events) {
                    const resourceEventEvent = event;
                    const device = lodash_1.default.find(this.devices, device => device.getName() === resourceEventEvent.resourceUpdate.name);
                    if (device)
                        device.event(resourceEventEvent);
                }
                else if (event.resourceUpdate.traits) {
                    const resourceTraitEvent = event;
                    const device = lodash_1.default.find(this.devices, device => device.getName() === resourceTraitEvent.resourceUpdate.name);
                    if (device)
                        device.event(resourceTraitEvent);
                }
            });
            this.subscription.on('error', error => {
                this.log.error("Plugin initialization failed, there was a failure with event subscription. Did you read the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from", error);
                this.subscribed = false;
            });
        }
        catch (error) {
            this.log.error("Plugin initialization failed, there was a failure with event subscription. Did you read the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from", error);
            this.subscribed = false;
        }
    }
    async list_devices() {
        var _a;
        if (!this.subscribed)
            return this.devices;
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.list({ parent: `enterprises/${this.projectId}` });
            this.log.debug('Receieved list of devices: ', response.data.devices);
            const structures = new Set((_a = response.data.devices) === null || _a === void 0 ? void 0 : _a.map(device => {
                var _a;
                return (_a = device.parentRelations) === null || _a === void 0 ? void 0 : _a.map(relation => relation.parent).filter(parent => parent != null).map(parent => { var _a; return (_a = /structures\/([^/]+)/.exec(parent)) === null || _a === void 0 ? void 0 : _a[1]; }).filter(structure => structure != null);
            }).flat());
            if (structures.size > 1 && this.structureId == null) {
                this.log.info('More than one structure found, consider setting `structureId`:', structures);
                return;
            }
            this.devices = (0, lodash_1.default)(response.data.devices)
                .filter(this.structureId === undefined ?
                () => true :
                device => { var _a, _b; return ((_b = (_a = device.parentRelations) === null || _a === void 0 ? void 0 : _a.some(relation => { var _a; return (_a = relation.parent) === null || _a === void 0 ? void 0 : _a.includes(`structures/${this.structureId}`); })) !== null && _b !== void 0 ? _b : false); })
                .filter(device => device.name !== null)
                .map(device => {
                switch (device.type) {
                    case 'sdm.devices.types.DOORBELL':
                        return new Doorbell_1.Doorbell(this.smartdevicemanagement, device, this.log);
                    case 'sdm.devices.types.CAMERA':
                        return new Camera_1.Camera(this.smartdevicemanagement, device, this.log);
                    case 'sdm.devices.types.DISPLAY':
                        return new Display_1.Display(this.smartdevicemanagement, device, this.log);
                    case 'sdm.devices.types.THERMOSTAT':
                        return new Thermostat_1.Thermostat(this.smartdevicemanagement, device, this.log);
                    default:
                        return new UnknownDevice_1.UnknownDevice(this.smartdevicemanagement, device, this.log);
                }
            })
                .value();
        }
        catch (error) {
            this.log.error('Could not execute device LIST request: ', JSON.stringify(error));
        }
        return this.devices;
    }
}
exports.SmartDeviceManagement = SmartDeviceManagement;
//# sourceMappingURL=Api.js.map