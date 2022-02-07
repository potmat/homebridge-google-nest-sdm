"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoorbellStreamingDelegate = void 0;
const StreamingDelegate_1 = require("./StreamingDelegate");
class DoorbellStreamingDelegate extends StreamingDelegate_1.StreamingDelegate {
    constructor(log, api, platform, camera, accessory) {
        super(log, api, platform, camera, accessory);
        this.controller = new this.hap.DoorbellController(this.options);
    }
    getController() {
        return this.controller;
    }
}
exports.DoorbellStreamingDelegate = DoorbellStreamingDelegate;
//# sourceMappingURL=DoorbellStreamingDelegate.js.map