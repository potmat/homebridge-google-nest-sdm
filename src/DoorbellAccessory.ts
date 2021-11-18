import {
    PlatformAccessory,
    PlatformAccessoryEvent,
    Logger, API
} from 'homebridge';
import {Platform} from './Platform';
import {Config} from "./Config";
import {Doorbell} from "./sdm/Doorbell";
import {Accessory} from "./Accessory";
import {DoorbellStreamingDelegate} from "./DoorbellStreamingDelegate";

export class DoorbellAccessory extends Accessory<Doorbell> {
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

        this.streamingDelegate = new DoorbellStreamingDelegate(log, api, this.platform.config as unknown as Config, this.device);
        this.accessory.configureController(this.streamingDelegate.getController());

        this.device.onRing = this.handleRing.bind(this);
    }

    handleRing(): void {
        this.log.debug('Doorbell ring!');
        this.streamingDelegate.getController().ringDoorbell();
    }
}
