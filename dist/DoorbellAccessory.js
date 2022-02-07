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
    }
}
exports.DoorbellAccessory = DoorbellAccessory;
//# sourceMappingURL=DoorbellAccessory.js.map