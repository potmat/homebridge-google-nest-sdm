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
    private subscribed = true;
    private static readonly RECONNECT_MIN_MS = 5000;
    private static readonly RECONNECT_MAX_MS = 60000;
    private static readonly RECYCLE_MS = 12 * 60 * 60 * 1000; // proactive recycle for half-open stalls
    private static readonly RECYCLE_DELAY_MS = 2000;          // deliberate recycle: short fixed gap, no backoff
    private reconnectDelay = SmartDeviceManagement.RECONNECT_MIN_MS;
    private recycleTimer?: ReturnType<typeof setTimeout>;
    private consecFails = 0; // consecutive setup/reconnect failures, reset on healthy traffic; throttles the warn

    constructor(config: Config, log: Logger) {
        this.log = log;

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
            this.subscribeToEvents(config.subscriptionId);
        } catch (error: any) {
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
    private subscribeToEvents(subscriptionId: string) {
        try {
            const sub = this.pubSubClient!.subscription(subscriptionId);
            this.subscription = sub;
            this.subscribed = true;

            let reconnectScheduled = false;
            // Reconnecting restores the flow of FUTURE events; it does NOT recover events missed
            // during the outage. Pub/Sub redelivers the backlog on re-subscribe, but anything older
            // than the freshness window (see #219 / isEventStale) is discarded at that point — by
            // design, since a motion alert delivered minutes late is worse than no alert. So an
            // outage longer than that window means those events are gone, not merely delayed.
            const reconnect = (reason: string, error?: any) => {
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
                        const fatal = /NOT_FOUND|PERMISSION_DENIED|not found|permission/i.test(String(error?.message ?? error ?? ''));
                        this.log.warn(fatal
                            ? `Nest event subscription ${reason} — this looks like a bad subscription id or revoked access; check the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from (retrying in ${delay / 1000}s)`
                            : `Nest event subscription ${reason}; reconnecting in ${delay / 1000}s`, error ?? '');
                    }
                }

                // close() first: it flips isOpen synchronously and returns a promise that can reject
                // during an outage (ack-flush RPC failure) — an unhandled rejection would crash the
                // process on Node >= 15. Then drop listeners; absorb any late 'error' forwarded from
                // the subscriber during in-flight gRPC teardown.
                Promise.resolve(sub.close()).catch(() => { /* ignore teardown errors */ });
                sub.removeAllListeners();
                sub.on('error', () => { /* absorb late errors after teardown */ });
                setTimeout(() => this.subscribeToEvents(subscriptionId), delay);
                if (!recycle)
                    this.reconnectDelay = Math.min(this.reconnectDelay * 2, SmartDeviceManagement.RECONNECT_MAX_MS);
            };

            sub.on('message', message => {
                message.ack();
                this.reconnectDelay = SmartDeviceManagement.RECONNECT_MIN_MS; // healthy traffic resets backoff
                this.consecFails = 0;

                if (!this.devices)
                    return;

                this.log.debug('Event received: ' + message.data.toString());

                // The payload is external input we do not control, so no single malformed message
                // may take down the bridge; relationUpdate events carry no resourceUpdate.
                try {
                    const event: Events.Event = JSON.parse(message.data);

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
                            device.event(resourceEventEvent);
                    } else if ((resourceUpdate as Events.ResourceTraitUpdate).traits) {
                        const resourceTraitEvent = event as Events.ResourceTraitEvent;
                        const device = _.find(this.devices, device => device.getName() === resourceTraitEvent.resourceUpdate.name);
                        if (device)
                            device.event(resourceTraitEvent);
                    }
                } catch (error: any) {
                    this.log.error('Could not handle event: ', error?.message ?? error);
                }
            });

            sub.on('error', error => reconnect('error', error));
            sub.on('close', () => reconnect('closed'));

            // A half-open connection can stall without emitting 'error' or 'close'. Recreate the
            // subscription periodically as a backstop; Pub/Sub re-delivers anything published during
            // the brief gap, so no events are lost.
            clearTimeout(this.recycleTimer);
            this.recycleTimer = setTimeout(() => reconnect('periodic recycle'), SmartDeviceManagement.RECYCLE_MS);
        } catch (error: any) {
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

    async list_devices(): Promise<Device[] | undefined> {

        if (!this.subscribed)
            return this.devices;

        try {
            const response = await this.smartdevicemanagement.enterprises.devices.list({parent: `enterprises/${this.projectId}`})

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
