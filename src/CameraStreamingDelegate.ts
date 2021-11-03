import {StreamingDelegate} from "./StreamingDelegate";
import {API, CameraController, Logger} from "homebridge";
import {Config} from "./Config";
import {Camera} from "./sdm/Camera";

export class CameraStreamingDelegate extends StreamingDelegate<CameraController> {

    constructor(log: Logger, api: API, config: Config, camera: Camera) {
        super(log, api, config, camera);
        this.controller = new this.hap.CameraController(this.options);
    }

    getController(): CameraController {
        return this.controller;
    }
}
