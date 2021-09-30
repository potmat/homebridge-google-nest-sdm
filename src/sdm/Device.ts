import * as google from "googleapis";
import {Logger} from "homebridge";
import _ from "lodash";

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

    async executeCommand<T, U>(name: string, params?: T): Promise<U> {
        this.log.debug(`Executing command ${name} with parameters ${JSON.stringify(params)}`);

        return await this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.device?.name || undefined,
            requestBody: {
                command: name,
                params: params
            }
        }).then(response => {
            this.log.debug(`Execution of command ${name} returned ${JSON.stringify(response.data.results)}`);

            return <U>response.data.results;
        })
    }
}
