import _ from 'lodash';
import * as google from 'googleapis';
import {Logger} from 'homebridge';
import {Config} from "../Config";

import {Device} from "./Device";
import {Camera} from "./Camera";
import {Doorbell} from "./Doorbell";
import {Thermostat} from "./Thermostat";
import {UnknownDevice} from "./UnknownDevice";

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
