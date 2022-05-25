import {StreamingDelegate} from "./StreamingDelegate";
import {API, CameraController, Logger, PlatformAccessory} from "homebridge";
import {Camera} from "./sdm/Camera";
import {Platform} from "./Platform";

export class CameraStreamingDelegate extends StreamingDelegate<CameraController> {

    constructor(log: Logger, api: API, platform: Platform, camera: Camera, accessory: PlatformAccessory) {
        super(log, api, platform, camera, accessory);
        this.controller = new this.hap.CameraController(this.options);
    }

    getController(): CameraController {
        return this.controller;
    }
}
