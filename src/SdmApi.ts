import _ from 'lodash';
import * as google from 'googleapis';
import {Logger} from 'homebridge';
import {Config} from "./Config";
import {Hvac, Temperature, ThermostatEco, ThermostatMode, ThermostatTemperatureSetpoint} from "./Traits";
import {
    ThermostatMode_SetMode,
    ThermostatTemperatureSetpoint_SetCool,
    ThermostatTemperatureSetpoint_SetHeat,
    ThermostatTemperatureSetpoint_SetRange
} from "./Commands";


export abstract class Device {
    smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement;
    device: google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1Device;
    lastRefresh: number;
    displayName: string|null|undefined;
    private log: Logger;
    constructor(smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement,
                device: google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1Device,
                log: Logger) {
        this.smartdevicemanagement = smartdevicemanagement;
        this.device = device;
        this.lastRefresh = Date.now();
        const parent = <google.smartdevicemanagement_v1.Schema$GoogleHomeEnterpriseSdmV1ParentRelation|undefined>_.find(device.parentRelations, relation => relation.displayName);
        this.displayName = parent?.displayName;
        this.log = log;
    }

    getName(): string {
        return <string>this.device.name;
    }

    getDisplayName() : string {
        return this.displayName ? this.displayName : 'Unknown Camera';
    }

    async refresh() {
        this.smartdevicemanagement.enterprises.devices.get({name : this.getName()})
            .then(response => {
                this.device = response.data;
                this.lastRefresh = Date.now();
            })
    }

    async getTrait<T>(name: string): Promise<T> {
        const howLongAgo: number = Date.now() - this.lastRefresh;
        if (howLongAgo > 10000)
            await this.refresh();

        const value = this.device?.traits ? this.device?.traits[name] : undefined;
        this.log.debug(`Request for trait ${name} had value ${JSON.stringify(value)}`);
        return value;
    }

    async executeCommand<T>(name: string, params: T): Promise<any> {
        this.log.debug(`Executing command ${name} with parameters ${JSON.stringify(params)}`);

        this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.device?.name || undefined,
            requestBody: {
                command: name,
                params: params
            }
        })
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

    getResolutions(): [number, number, number][] {
        return [[1280, 720, 15],[1920, 1080, 15]];
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

export class Doorbell extends Camera {
    getResolutions(): [number, number, number][] {
        return [[1280, 720, 15],[1920, 1080, 15],[1600, 1200, 15]];
    }
}

export class Thermostat extends Device {

    async getEco(): Promise<string> {
        const trait =  await this.getTrait<ThermostatEco>('sdm.devices.traits.ThermostatEco');
        return trait.mode;
    }

    async getMode(): Promise<string> {
        const trait =  await this.getTrait<ThermostatMode>('sdm.devices.traits.ThermostatMode');
        return trait.mode;
    }

    async getHvac(): Promise<string> {
        const trait =  await this.getTrait<Hvac>('sdm.devices.traits.ThermostatHvac');
        return trait.status;
    }

    async getTemparature(): Promise<number> {
        const trait =  await this.getTrait<Temperature>('sdm.devices.traits.Temperature');
        return trait.ambientTemperatureCelsius;
    }

    async getTargetTemparature(): Promise<number|undefined> {

        const eco = await this.getEco();

        if (eco !== 'OFF')
            return Promise.resolve(undefined);

        const trait =  await this.getTrait<ThermostatTemperatureSetpoint>('sdm.devices.traits.ThermostatTemperatureSetpoint');
        const mode = await this.getMode();

        switch (mode) {
            case 'OFF':
                return Promise.resolve(undefined);
            case 'HEAT':
                return trait.heatCelsius;
            case 'COOL':
                return trait.coolCelsius;
            case 'HEATCOOL':
                //todo: what to return here?
                return Promise.resolve(undefined);
        }

    }

    async setTemparature(temparature:number): Promise<void> {
        const eco = await this.getEco();

        if (eco !== 'OFF')
            return Promise.resolve(undefined);

        const mode = await this.getMode();

        switch (mode) {
            case 'HEAT':
                await this.executeCommand<ThermostatTemperatureSetpoint_SetHeat>("sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat", {
                    heatCelsius: temparature
                });
            case 'COOL':
                await this.executeCommand<ThermostatTemperatureSetpoint_SetCool>("sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool", {
                    coolCelsius: temparature
                });
            case 'HEATCOOL':
                //todo: what to do here?
                return Promise.resolve(undefined);
        }
    }

    async setMode(mode:string): Promise<void> {
        await this.executeCommand<ThermostatMode_SetMode>("sdm.devices.commands.ThermostatMode.SetMode", {
            mode: mode
        });
    }
}

export class UnknownDevice extends Device {}

export class SmartDeviceManagement {
    private oauth2Client: google.Auth.OAuth2Client;
    private smartdevicemanagement: google.smartdevicemanagement_v1.Smartdevicemanagement;
    private projectId: string;
    private log: Logger;

    constructor(config: Config, log: Logger) {
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
        this.log = log;
    }

    async list_devices(): Promise<Device[]> {
        return this.smartdevicemanagement.enterprises.devices.list({parent: `enterprises/${this.projectId}`})
            .then(response => {
                return _(response.data.devices)
                    .filter(device => device.name !== null)
                    .map(device => {
                        switch (device.type) {
                            case 'sdm.devices.types.DOORBELL':
                                return new Doorbell(this.smartdevicemanagement, device, this.log)
                            case 'sdm.devices.types.CAMERA':
                                return new Camera(this.smartdevicemanagement, device, this.log)
                            case 'sdm.devices.types.THERMOSTAT':
                                return new Thermostat(this.smartdevicemanagement, device, this.log)
                            default:
                                return new UnknownDevice(this.smartdevicemanagement, device, this.log);
                        }
                    })
                    .value();
            })
    }
}
