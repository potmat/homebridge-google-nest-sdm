import {StreamingDelegate} from "./StreamingDelegate";
import {API, DoorbellController, Logger} from "homebridge";
import {Config} from "./Config";
import {Camera} from "./sdm/Camera";

export class DoorbellStreamingDelegate extends StreamingDelegate<DoorbellController> {

    constructor(log: Logger, api: API, config: Config, camera: Camera) {
        super(log, api, config, camera);
        this.controller = new this.hap.DoorbellController(this.options);
    }

    getController(): DoorbellController {
        return this.controller;
    }
}
