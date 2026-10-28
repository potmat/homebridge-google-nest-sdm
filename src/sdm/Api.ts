import _ from 'lodash';
import * as google from 'googleapis';
import * as pubsub from '@google-cloud/pubsub';
import {Logger} from 'homebridge';
import {Config} from "../Config";
import * as Events from './Events';
import {Device} from "./Device";
import {Camera} from "./Camera";
import {Doorbell} from "./Doorbell";
import {Thermostat} from "./Thermostat";
import {UnknownDevice} from "./UnknownDevice";
import {Display} from "./Display";

export class SmartDeviceManagement {
    private oauth2Client: google.Auth.OAuth2Client;
    private smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement;
    private pubSubClient: pubsub.PubSub | undefined;
    private subscription: pubsub.Subscription | undefined;
    private projectId: string;
    private log: Logger;
    private devices: Device[] | undefined;
    private stopped = false;
    private retryDelay = 1000;
    private reconnectTimer?: NodeJS.Timeout;
    private refreshTimer?: NodeJS.Timeout;
    private refreshPromise?: Promise<void>;
    private subscriptionId: string;

    constructor(config: Config, log: Logger) {
        this.log = log;
        this.subscriptionId = config.subscriptionId;

        this.oauth2Client = new google.Auth.OAuth2Client(
            config.clientId,
            config.clientSecret
        );
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
            this.connect();
        } catch (error: any) {
            this.log.error('Could not initialize event client:', error.message);
        }
        this.refreshTimer = setInterval(() => void this.refreshDevices(), 5 * 60 * 1000);
        this.refreshTimer.unref();
    }

    private connect() {
        if (this.stopped || !this.pubSubClient) return;
        try {
            const subscription = this.pubSubClient.subscription(this.subscriptionId);
            this.subscription = subscription;
            subscription.on('message', message => {
                if (this.stopped || this.subscription !== subscription) return;
                this.retryDelay = 1000;
                if (!this.devices) {
                    message.nack();
                    return;
                }

                this.log.debug('Event received: ' + message.data.toString());

                // This callback runs asynchronously, long after the try/catch below
                // has returned, so anything thrown here is an unhandled exception
                // rather than a caught one. The payload is external input we do not
                // control, so no single malformed message may take down the bridge.
                try {
                    const event: Events.Event = JSON.parse(message.data);

                    // Relation updates (a device added to, removed from, or moved
                    // between structures/rooms) carry a relationUpdate and NO
                    // resourceUpdate. Reading resourceUpdate.events on one of those
                    // throws, so bail before the trait/event dispatch below.
                    const resourceUpdate = (event as Events.ResourceEventEvent | Events.ResourceTraitEvent).resourceUpdate;
                    if (!resourceUpdate) {
                        this.log.debug((event as Events.ResourceRelationEvent).relationUpdate
                            ? 'Ignoring relation update event.'
                            : 'Ignoring event with no resourceUpdate.');
                        return;
                    }

                    if ((resourceUpdate as Events.ResourceEventUpdate).events) {
                        const resourceEventEvent = event as Events.ResourceEventEvent;
                        const device = _.find(this.devices, device => device.getName() === resourceEventEvent.resourceUpdate.name);
                        if (device)
                            device.receiveEvent(resourceEventEvent);
                    } else if ((resourceUpdate as Events.ResourceTraitUpdate).traits) {
                        const resourceTraitEvent = event as Events.ResourceTraitEvent;
                        const device = _.find(this.devices, device => device.getName() === resourceTraitEvent.resourceUpdate.name);
                        if (device)
                            device.receiveEvent(resourceTraitEvent);
                    }
                } catch (error: any) {
                    this.log.error('Could not handle event: ', error?.message ?? error);
                } finally {
                    // Invalid payloads must not poison the queue. Periodic GETs repair traits.
                    message.ack();
                }
            });
            subscription.on('error', error => {
                if (this.stopped || this.subscription !== subscription) return;
                this.log.error('Event subscription failed; reconnecting:', error.message);
                this.scheduleReconnect();
            });
            subscription.on('close', () => {
                if (this.subscription === subscription) this.scheduleReconnect();
            });
        } catch (error: any) {
            this.log.error('Could not open event subscription:', error.message);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.stopped || this.reconnectTimer) return;
        const delay = this.retryDelay;
        this.retryDelay = Math.min(this.retryDelay * 2, 60000);
        this.reconnectTimer = setTimeout(async () => {
            const old = this.subscription;
            this.subscription = undefined;
            try { await old?.close(); }
            catch (error: any) { this.log.warn('Could not close event subscription:', error.message); }
            this.reconnectTimer = undefined;
            if (this.stopped) return;
            this.connect();
            await this.refreshDevices();
        }, delay);
        this.reconnectTimer.unref();
    }

    private refreshDevices(): Promise<void> {
        if (this.stopped || !this.devices) return Promise.resolve();
        if (!this.refreshPromise) {
            this.refreshPromise = Promise.all(this.devices.map(device => device.refresh()))
                .then(() => undefined)
                .catch((error: Error) => this.log.error('Device reconciliation failed:', error.message))
                .finally(() => { this.refreshPromise = undefined; });
        }
        return this.refreshPromise;
    }

    async close() {
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.devices?.forEach(device => device.close());
        try { await this.subscription?.close(); }
        finally { await this.pubSubClient?.close(); }
    }

    async list_devices(): Promise<Device[] | undefined> {
        if (this.devices) return this.devices;

        try {
            const response = await this.smartdevicemanagement.enterprises.devices.list({parent: `enterprises/${this.projectId}`}, {timeout: 30000})

            if (this.stopped) return;
            this.log.debug('Receieved list of devices: ', response.data.devices)

            this.devices = _(response.data.devices)
                .filter(device => device.name !== null)
                .map(device => {
                    switch (device.type) {
                        case 'sdm.devices.types.DOORBELL':
                            return new Doorbell(this.smartdevicemanagement, device, this.log)
                        case 'sdm.devices.types.CAMERA':
                            return new Camera(this.smartdevicemanagement, device, this.log)
                        case 'sdm.devices.types.DISPLAY':
                            return new Display(this.smartdevicemanagement, device, this.log)
                        case 'sdm.devices.types.THERMOSTAT':
                            return new Thermostat(this.smartdevicemanagement, device, this.log)
                        default:
                            return new UnknownDevice(this.smartdevicemanagement, device, this.log);
                    }
                })
                .value();
        } catch (error: any) {
            this.log.error('Could not execute device LIST request: ', JSON.stringify(error));
        }

        return this.devices;
    }
}
