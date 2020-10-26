import _ from 'lodash';
import * as google from 'googleapis';
import {Config} from "./Config";


export abstract class Device {
    smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement;
    device: google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1Device;
    lastRefresh: number;
    displayName: string|null|undefined;
    constructor(smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement,
                device: google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1Device) {
        this.smartdevicemanagement = smartdevicemanagement;
        this.device = device;
        this.lastRefresh = Date.now();
        const parent = <google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1ParentRelation|undefined>_.find(device.parentRelations, relation => relation.displayName);
        this.displayName = parent?.displayName;
    }

    getName(): string {
        return <string>this.device.name;
    }

    async refresh() {
        this.smartdevicemanagement.enterprises.devices.get({name : this.getName()})
            .then(response => {
                this.device = response.data;
                this.lastRefresh = Date.now();
            })
    }

    async getTrait(name: string): Promise<any> {
        const howLongAgo: number = Date.now() - this.lastRefresh;
        if (howLongAgo > 10000)
            await this.refresh();
        return this.device?.traits?.name
    }
}

export type StreamInfo = {
    rtspUrl: string;
    token: string;
    extensionToken: string;
    expiresAt: Date;
}

export class Camera extends Device {
    getSnapshot(): Buffer|null {
        return null;
    }

    async getStreamInfo(): Promise<StreamInfo> {
        return this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.getName(),
            requestBody: {
                command: 'sdm.devices.commands.CameraLiveStream.GenerateRtspStream'
            }
        }).then(response => {
            return {
                rtspUrl: response.data?.results?.streamUrls?.rtspUrl,
                token: response.data?.results?.streamToken,
                extensionToken: response.data?.results?.streamExtensionToken,
                expiresAt: new Date(response.data?.results?.expiresAt)
            }
        })
    }

    async stopStream(extensionToken: string): Promise<any> {
        return this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.getName(),
            requestBody: {
                command: 'sdm.devices.commands.CameraLiveStream.StopRtspStream',
                params: {
                    streamExtensionToken: extensionToken
                }
            }
        }).then(response => {
            return response.data?.results?.streamUrls?.rtspUrl;
        })
    }
}

export class Doorbell extends Camera {}

export class Thermostat extends Device {
    async getTemparature(): Promise<number> {
        const trait =  await this.getTrait('sdm.devices.traits.Temperature');
        return trait.ambientTemperatureCelsius;
    }
}

export class UnknownDevice extends Device {}

export class SmartDeviceManagement {
    private oauth2Client: google.Auth.OAuth2Client;
    private smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement;
    private projectId: string;

    constructor(config: Config) {
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
    }

    async list_devices(): Promise<Device[]> {
        return this.smartdevicemanagement.enterprises.devices.list({parent: `enterprises/${this.projectId}`})
            .then(response => {
                return _(response.data.devices)
                    .filter(device => device.name !== null)
                    .map(device => {
                        switch (device.type) {
                            case 'sdm.devices.types.DOORBELL':
                                return new Doorbell(this.smartdevicemanagement, device)
                            case 'sdm.devices.types.CAMERA':
                                return new Camera(this.smartdevicemanagement, device)
                            case 'sdm.devices.types.THERMOSTAT':
                                return new Thermostat(this.smartdevicemanagement, device)
                            default:
                                return new UnknownDevice(this.smartdevicemanagement, device);
                        }
                    })
                    .value();
            })
    }
}
