"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartDeviceManagement = void 0;
const lodash_1 = __importDefault(require("lodash"));
const google = __importStar(require("googleapis"));
const ApiError_1 = require("./ApiError");
const pubsub = __importStar(require("@google-cloud/pubsub"));
const Camera_1 = require("./Camera");
const Doorbell_1 = require("./Doorbell");
const Thermostat_1 = require("./Thermostat");
const UnknownDevice_1 = require("./UnknownDevice");
const Display_1 = require("./Display");
const PubSubAuth_1 = require("./PubSubAuth");
class SmartDeviceManagement {
    constructor(config, log) {
        this.subscribed = true;
        this.log = log;
        this.oauth2Client = new google.Auth.OAuth2Client(config.clientId, config.clientSecret);
        this.projectId = config.projectId;
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
                auth: (0, PubSubAuth_1.createPubSubAuth)(config)
            });
            this.subscription = this.pubSubClient.subscription(config.subscriptionId);
            this.subscription.on('message', message => {
                var _a;
                message.ack();
                if (!this.devices)
                    return;
                this.log.debug('Event received: ' + message.data.toString());
                // This callback runs asynchronously, long after the try/catch below
                // has returned, so anything thrown here is an unhandled exception
                // rather than a caught one. The payload is external input we do not
                // control, so no single malformed message may take down the bridge.
                try {
                    const event = JSON.parse(message.data.toString());
                    // Relation updates (a device added to, removed from, or moved
                    // between structures/rooms) carry a relationUpdate and NO
                    // resourceUpdate. Reading resourceUpdate.events on one of those
                    // throws, so bail before the trait/event dispatch below.
                    const resourceUpdate = event.resourceUpdate;
                    if (!resourceUpdate) {
                        this.log.debug(event.relationUpdate
                            ? 'Ignoring relation update event.'
                            : 'Ignoring event with no resourceUpdate.');
                        return;
                    }
                    if (resourceUpdate.events) {
                        const resourceEventEvent = event;
                        const device = lodash_1.default.find(this.devices, device => device.getName() === resourceEventEvent.resourceUpdate.name);
                        if (device)
                            device.event(resourceEventEvent);
                    }
                    else if (resourceUpdate.traits) {
                        const resourceTraitEvent = event;
                        const device = lodash_1.default.find(this.devices, device => device.getName() === resourceTraitEvent.resourceUpdate.name);
                        if (device)
                            device.event(resourceTraitEvent);
                    }
                }
                catch (error) {
                    this.log.error('Could not handle event: ', (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error);
                }
            });
            this.subscription.on('error', error => {
                this.log.error(`Plugin initialization failed, there was a failure with event subscription: ${(0, ApiError_1.describePubSubError)(error)}. Did you read the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from`);
                this.subscribed = false;
            });
        }
        catch (error) {
            this.log.error(`Plugin initialization failed, there was a failure with event subscription: ${(0, ApiError_1.describePubSubError)(error)}. Did you read the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from`);
            this.subscribed = false;
        }
    }
    async close() {
        const subscription = this.subscription;
        const pubSubClient = this.pubSubClient;
        this.subscription = undefined;
        this.pubSubClient = undefined;
        try {
            await (subscription === null || subscription === void 0 ? void 0 : subscription.close());
        }
        catch (error) {
            this.log.warn(`Could not close the event subscription cleanly: ${(0, ApiError_1.describePubSubError)(error)}`);
        }
        try {
            await (pubSubClient === null || pubSubClient === void 0 ? void 0 : pubSubClient.close());
        }
        catch (error) {
            this.log.warn(`Could not close the Pub/Sub client cleanly: ${(0, ApiError_1.describePubSubError)(error)}`);
        }
    }
    async list_devices() {
        if (!this.subscribed)
            return this.devices;
        try {
            const response = await this.smartdevicemanagement.enterprises.devices.list({ parent: `enterprises/${this.projectId}` });
            this.log.debug('Receieved list of devices: ', response.data.devices);
            this.devices = (0, lodash_1.default)(response.data.devices)
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
            this.log.error(`Could not execute device LIST request: ${(0, ApiError_1.describeApiError)(error)}`);
        }
        return this.devices;
    }
}
exports.SmartDeviceManagement = SmartDeviceManagement;
//# sourceMappingURL=Api.js.map