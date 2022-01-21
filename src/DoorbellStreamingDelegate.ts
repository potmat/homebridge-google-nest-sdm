import {StreamingDelegate} from "./StreamingDelegate";
import {API, DoorbellController, Logger} from "homebridge";
import {Camera} from "./sdm/Camera";
import {Platform} from "./Platform";

export class DoorbellStreamingDelegate extends StreamingDelegate<DoorbellController> {

    constructor(log: Logger, api: API, platform: Platform, camera: Camera) {
        super(log, api, platform, camera);
        this.controller = new this.hap.DoorbellController(this.options);
    }

    getController(): DoorbellController {
        return this.controller;
    }
}
