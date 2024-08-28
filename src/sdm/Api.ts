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
    private structureId: string | undefined;
    private log: Logger;
    private devices: Device[] | undefined;
    private subscribed = true;

    constructor(config: Config, log: Logger) {
        this.log = log;

        this.oauth2Client = new google.Auth.OAuth2Client(
            config.clientId,
            config.clientSecret
        );
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

                const event: Events.Event = JSON.parse(message.data);

                // if ((event as Events.ResourceRelationEvent).relationUpdate) {
                //     const resourceRelationtEvent = event as Events.ResourceRelationEvent;
                // } else
                if ((event as Events.ResourceEventEvent).resourceUpdate.events) {
                    const resourceEventEvent = event as Events.ResourceEventEvent;
                    const device = _.find(this.devices, device => device.getName() === resourceEventEvent.resourceUpdate.name);
                    if (device)
                        device.event(resourceEventEvent);
                } else if ((event as Events.ResourceTraitEvent).resourceUpdate.traits) {
                    const resourceTraitEvent = event as Events.ResourceTraitEvent;
                    const device = _.find(this.devices, device => device.getName() === resourceTraitEvent.resourceUpdate.name);
                    if (device)
                        device.event(resourceTraitEvent);
                }
            });
            this.subscription.on('error', error => {
                this.log.error("Plugin initialization failed, there was a failure with event subscription. Did you read the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from", error);
                this.subscribed = false;
            });
        } catch (error: any) {
            this.log.error("Plugin initialization failed, there was a failure with event subscription. Did you read the readme: https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from", error);
            this.subscribed = false;
        }
    }

    async list_devices(): Promise<Device[] | undefined> {

        if (!this.subscribed)
            return this.devices;

        try {
            const response = await this.smartdevicemanagement.enterprises.devices.list({parent: `enterprises/${this.projectId}`})

            this.log.debug('Receieved list of devices: ', response.data.devices)
            const structures = new Set(response.data.devices
                ?.map(device =>
                    device.parentRelations
                        ?.map(relation => relation.parent)
                        .filter(parent => parent != null)
                        .map(parent => /structures\/([^/]+)/.exec(parent!)?.[1])
                        .filter(structure => structure != null))
                .flat()
            )
            if (structures.size > 1 && this.structureId == null) {
                this.log.info('More than one structure found, consider setting `structureId`:', structures)
                return;
            }

            this.devices = _(response.data.devices)
                .filter(
                    this.structureId === undefined ?
                        () => true :
                        device => (device.parentRelations?.some(relation => relation.parent?.includes(`structures/${this.structureId}`)) ?? false)
                )
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
