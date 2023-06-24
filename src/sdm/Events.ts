import * as Traits from './Traits';

export enum Constants {
    CameraMotion = 'sdm.devices.events.CameraMotion.Motion',
    CameraPerson = 'sdm.devices.events.CameraPerson.Person',
    CameraSound = 'sdm.devices.events.CameraSound.Sound',
    DoorbellChime = 'sdm.devices.events.DoorbellChime.Chime',
    ClipPreview = 'sdm.devices.events.CameraClipPreview.ClipPreview'
}

export enum RelationUpdateType {
    CREATED,
    UPDATED,
    DELETED
}

export enum ThreadStateType {
    STARTED = 'STARTED',
    UPDATED = 'UPDATED',
    ENDED = 'ENDED'
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
    eventThreadState: ThreadStateType;
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

export interface CameraClipPreview {
    eventSessionId: string;
    previewUrl: string;
}

export interface DoorbellChime {
    eventSessionId: string;
    eventId: string;
}
