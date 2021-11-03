import * as Traits from './Traits';
import exp from "constants";

export enum Constants {
    CameraMotion = 'sdm.devices.events.CameraMotion',
    CameraPerson = 'sdm.devices.events.CameraPerson',
    CameraSound = 'sdm.devices.events.CameraSound',
    DoorbellChime = 'sdm.devices.events.DoorbellChime',
}

export enum RelationUpdateType {
    CREATED,
    UPDATED,
    DELETED
}

export interface RelationUpdate {
    type: RelationUpdateType,
    subject: string;
    object: string;
}

export interface ResourceUpdate {
    name: string;
}

export interface ResourceEventUpdate extends ResourceUpdate {
    events: {
        [Constants.CameraMotion]?: CameraMotion;
        [Constants.CameraMotion]?: CameraPerson;
        [Constants.CameraMotion]?: CameraSound;
        [Constants.CameraMotion]?: DoorbellChime;
    }
}

export interface ResourceTraitUpdate extends ResourceUpdate {
    traits: {
        [Traits.Constants.ThermostatTemperatureSetpoint]?: Traits.ThermostatTemperatureSetpoint;
        [Traits.Constants.Temperature]?: Traits.Temperature;
        [Traits.Constants.ThermostatMode]?: Traits.ThermostatMode;
        [Traits.Constants.ThermostatEco]?: Traits.ThermostatEco;
        [Traits.Constants.Humidity]?: Traits.Humidity;
        [Traits.Constants.Connectivity]?: Traits.Connectivity;
        [Traits.Constants.Fan]?: Traits.Fan;
        [Traits.Constants.Settings]?: Traits.Settings;
    };
}

export interface Event {
    eventId: string;
    timestamp: string;
    userId: string;
}

export interface ResourceRelationEvent extends Event {
    relationUpdate: RelationUpdate;
}

export interface ResourceEventEvent extends Event {
    resourceUpdate: ResourceEventUpdate;
    eventThreadId: string;
    eventThreadState: string;
    resourceGroup?: string[];
}

export interface ResourceTraitEvent extends Event {
    resourceUpdate: ResourceTraitUpdate;
    resourceGroup?: string[];
}

export interface CameraMotion {
    eventSessionId: string;
    eventId: string;
}

export interface CameraPerson {
    eventSessionId: string;
    eventId: string;
}

export interface CameraSound {
    eventSessionId: string;
    eventId: string;
}

export interface DoorbellChime {
    eventSessionId: string;
    eventId: string;
}
