import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    CharacteristicSetCallback,
    CharacteristicGetCallback,
    PlatformAccessoryEvent,
    HAP,
    CameraControllerOptions,
    Logger
} from 'homebridge';
import { Platform } from './Platform';
import {StreamingDelegate} from "./StreamingDelegate";
import {Camera} from "./SdmApi";

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CameraAccessory {

    constructor(
        private readonly hap: HAP,
        private readonly log: Logger,
        private readonly platform: Platform,
        private readonly accessory: PlatformAccessory) {
            // set accessory information
            this.accessory.getService(this.platform.Service.AccessoryInformation)!
                .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest')

            accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
              log.info("%s identified!", accessory.displayName);
            });

            const streamingDelegate = new StreamingDelegate(hap, <Camera>accessory.context.device);
            const options: CameraControllerOptions = {
              cameraStreamCount: 2, // HomeKit requires at least 2 streams, but 1 is also just fine
              delegate: streamingDelegate,

              streamingOptions: {
                // srtp: true, // legacy option which will just enable AES_CM_128_HMAC_SHA1_80 (can still be used though)
                supportedCryptoSuites: [hap.SRTPCryptoSuites.NONE, hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80], // NONE is not supported by iOS just there for testing with Wireshark for example
                video: {
                  codec: {
                    profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
                    levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
                  },
                  resolutions: [
                    [1920, 1080, 30], // width, height, framerate
                    [1280, 960, 30],
                    [1280, 720, 30],
                    [1024, 768, 30],
                    [640, 480, 30],
                    [640, 360, 30],
                    [480, 360, 30],
                    [480, 270, 30],
                    [320, 240, 30],
                    [320, 240, 15], // Apple Watch requires this configuration (Apple Watch also seems to required OPUS @16K)
                    [320, 180, 30],
                  ],
                },
                /* audio option is omitted, as it is not supported in this example; HAP-NodeJS will fake an appropriate audio codec
                audio: {
                    comfort_noise: false, // optional, default false
                    codecs: [
                        {
                            type: AudioStreamingCodecType.OPUS,
                            audioChannels: 1, // optional, default 1
                            samplerate: [AudioStreamingSamplerate.KHZ_16, AudioStreamingSamplerate.KHZ_24], // 16 and 24 must be present for AAC-ELD or OPUS
                        },
                    ],
                },
                // */
              }
            }

            const cameraController = new hap.CameraController(options);
            streamingDelegate.controller = cameraController;
            accessory.configureController(cameraController);
        }
}
