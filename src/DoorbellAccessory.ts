import {
    PlatformAccessory,
    PlatformAccessoryEvent,
    Logger, API
} from 'homebridge';
import {Platform} from './Platform';
import {Doorbell} from "./sdm/Doorbell";
import {DoorbellStreamingDelegate} from "./DoorbellStreamingDelegate";
import {MotionAccessory} from "./MotionAccessory";

export class DoorbellAccessory extends MotionAccessory<Doorbell> {
    private streamingDelegate: DoorbellStreamingDelegate;

    constructor(
        api: API,
        log: Logger,
        platform: Platform,
        accessory: PlatformAccessory,
        device: Doorbell) {
        super(api, log, platform, accessory, device);

        this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            this.log.info("%s identified!", this.accessory.displayName);
        });

        this.streamingDelegate = new DoorbellStreamingDelegate(log, api, this.platform, this.device, this.accessory);
        this.accessory.configureController(this.streamingDelegate.getController());
        this.device.onRing = this.handleRing.bind(this);
    }

    handleRing(): void {
        this.log.debug('Doorbell ring!', this.accessory.displayName);
        this.streamingDelegate.getController().ringDoorbell();
    }
}
