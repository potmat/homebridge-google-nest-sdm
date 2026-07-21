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
        this.reconnectDelay = SmartDeviceManagement.RECONNECT_MIN_MS;
        this.consecFails = 0; // consecutive setup/reconnect failures, reset on healthy traffic; throttles the warn
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
            this.subscribeToEvents(config.subscriptionId);
        }
        catch (error) {
            this.log.error("Plugin initialization failed, there was a failure with event subscription. Did you read the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from", error);
            this.subscribed = false;
        }
    }
    /**
     * Subscribe to the Pub/Sub event stream, re-subscribing on error/close.
     *
     * The streaming-pull connection can drop silently — a half-open stream surfaces as a 'close'
     * with no 'error'. Upstream created the subscription once and, on error, only logged and set
     * subscribed=false (never handling 'close'), so a dropped connection permanently stopped all
     * camera events until Homebridge was restarted. Here we re-subscribe with exponential backoff
     * (reset on healthy traffic) plus a proactive recycle to catch half-open stalls. The whole
     * body is wrapped so a synchronous throw on a reconnect timer reschedules instead of crashing.
     */
    subscribeToEvents(subscriptionId) {
        try {
            const sub = this.pubSubClient.subscription(subscriptionId);
            this.subscription = sub;
            this.subscribed = true;
            let reconnectScheduled = false;
            const reconnect = (reason, error) => {
                var _a, _b;
                if (reconnectScheduled)
                    return;
                reconnectScheduled = true;
                this.subscribed = false;
                clearTimeout(this.recycleTimer);
                // A deliberate 12h recycle is healthy, not a failure: use a short fixed gap and do
                // NOT ratchet the backoff or the failure counter. Otherwise an idle camera's recycle
                // gap would grow past the 30s event-freshness window and silently drop events that
                // Pub/Sub redelivers on re-subscribe.
                const recycle = reason === 'periodic recycle';
                const delay = recycle ? SmartDeviceManagement.RECYCLE_DELAY_MS : this.reconnectDelay;
                if (!recycle) {
                    this.consecFails++;
                    if (this.consecFails <= 5 || this.consecFails % 12 === 0) {
                        // A NOT_FOUND / PERMISSION_DENIED won't self-heal — point at the readme once.
                        const fatal = /NOT_FOUND|PERMISSION_DENIED|not found|permission/i.test(String((_b = (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error) !== null && _b !== void 0 ? _b : ''));
                        this.log.warn(fatal
                            ? `Nest event subscription ${reason} — this looks like a bad subscription id or revoked access; check the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from (retrying in ${delay / 1000}s)`
                            : `Nest event subscription ${reason}; reconnecting in ${delay / 1000}s`, error !== null && error !== void 0 ? error : '');
                    }
                }
                // close() first: it flips isOpen synchronously and returns a promise that can reject
                // during an outage (ack-flush RPC failure) — an unhandled rejection would crash the
                // process on Node >= 15. Then drop listeners; absorb any late 'error' forwarded from
                // the subscriber during in-flight gRPC teardown.
                Promise.resolve(sub.close()).catch(() => { });
                sub.removeAllListeners();
                sub.on('error', () => { });
                setTimeout(() => this.subscribeToEvents(subscriptionId), delay);
                if (!recycle)
                    this.reconnectDelay = Math.min(this.reconnectDelay * 2, SmartDeviceManagement.RECONNECT_MAX_MS);
            };
            sub.on('message', message => {
                var _a;
                message.ack();
                this.reconnectDelay = SmartDeviceManagement.RECONNECT_MIN_MS; // healthy traffic resets backoff
                this.consecFails = 0;
                if (!this.devices)
                    return;
                this.log.debug('Event received: ' + message.data.toString());
                // The payload is external input we do not control, so no single malformed message
                // may take down the bridge; relationUpdate events carry no resourceUpdate.
                try {
                    const event = JSON.parse(message.data);
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
            sub.on('error', error => reconnect('error', error));
            sub.on('close', () => reconnect('closed'));
            // A half-open connection can stall without emitting 'error' or 'close'. Recreate the
            // subscription periodically as a backstop; Pub/Sub re-delivers anything published during
            // the brief gap, so no events are lost.
            clearTimeout(this.recycleTimer);
            this.recycleTimer = setTimeout(() => reconnect('periodic recycle'), SmartDeviceManagement.RECYCLE_MS);
        }
        catch (error) {
            // Creating the subscription can throw synchronously (bad pubSubClient/auth state after an
            // outage). On a reconnect this runs from a bare setTimeout with no handler above, so an
            // unhandled throw would crash the process on the very reconnect meant to self-heal.
            // Log (throttled) and reschedule instead of rethrowing.
            this.subscribed = false;
            this.consecFails++;
            if (this.consecFails <= 5 || this.consecFails % 12 === 0)
                this.log.warn(`Nest event subscription setup failed; retrying in ${this.reconnectDelay / 1000}s`, error);
            setTimeout(() => this.subscribeToEvents(subscriptionId), this.reconnectDelay);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, SmartDeviceManagement.RECONNECT_MAX_MS);
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
            this.log.error('Could not execute device LIST request: ', JSON.stringify(error));
        }
        return this.devices;
    }
}
exports.SmartDeviceManagement = SmartDeviceManagement;
SmartDeviceManagement.RECONNECT_MIN_MS = 5000;
SmartDeviceManagement.RECONNECT_MAX_MS = 60000;
SmartDeviceManagement.RECYCLE_MS = 12 * 60 * 60 * 1000; // proactive recycle for half-open stalls
SmartDeviceManagement.RECYCLE_DELAY_MS = 2000; // deliberate recycle: short fixed gap, no backoff
//# sourceMappingURL=Api.js.map