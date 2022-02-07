import {StreamingDelegate} from "./StreamingDelegate";
import {API, DoorbellController, Logger, PlatformAccessory} from "homebridge";
import {Camera} from "./sdm/Camera";
import {Platform} from "./Platform";

export class DoorbellStreamingDelegate extends StreamingDelegate<DoorbellController> {

    constructor(log: Logger, api: API, platform: Platform, camera: Camera, accessory: PlatformAccessory) {
        super(log, api, platform, camera, accessory);
        this.controller = new this.hap.DoorbellController(this.options);
    }

    getController(): DoorbellController {
        return this.controller;
    }
}
