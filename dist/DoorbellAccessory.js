"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoorbellAccessory = void 0;
const DoorbellStreamingDelegate_1 = require("./DoorbellStreamingDelegate");
const MotionAccessory_1 = require("./MotionAccessory");
class DoorbellAccessory extends MotionAccessory_1.MotionAccessory {
    constructor(api, log, platform, accessory, device) {
        super(api, log, platform, accessory, device);
        this.accessory.on("identify" /* IDENTIFY */, () => {
            this.log.info("%s identified!", this.accessory.displayName);
        });
        this.streamingDelegate = new DoorbellStreamingDelegate_1.DoorbellStreamingDelegate(log, api, this.platform, this.device, this.accessory);
        this.accessory.configureController(this.streamingDelegate.getController());
        this.device.onRing = this.handleRing.bind(this);
    }
    handleRing() {
        this.log.debug('Doorbell ring!', this.accessory.displayName);
        this.streamingDelegate.getController().ringDoorbell();
        // A ring is activity at the door: hold the motion window open too, so a
        // ring-triggered HKSV recording gets the same ~20s post-event tail instead
        // of ending at the first fragment (the recording generator only samples
        // MotionDetected when deciding to end a recording).
        this.handleMotion();
    }
}
exports.DoorbellAccessory = DoorbellAccessory;
//# sourceMappingURL=DoorbellAccessory.js.map