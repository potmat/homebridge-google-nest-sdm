import {Device} from './Device';
import * as Responses from './Responses';
import {GenerateRtspStream, GenerateWebRtcStream} from './Responses';
import * as Events from './Events';
import {ResourceEventEvent, ThreadStateType} from './Events';
import * as Commands from './Commands';
import {CameraLiveStream_GenerateWebRtcStream} from './Commands';
import axios from 'axios';
import fs from "fs";
import path from "path";
import _ from "lodash";
import * as Traits from "./Traits";
import {describeApiError} from "./ApiError";

export class Camera extends Device {

    protected static readonly MAX_EVENT_AGE_SECONDS = 30;

    private image: Buffer | null = null;

    getDisplayName(): string {
        return this.displayName ? this.displayName + ' Camera' : 'Unknown';
    }

    onMotion: (() => void) | undefined;

    async getSnapshot(): Promise<Buffer | undefined> {
        if (this.image) return this.image;

        //Nest cams do not have any method to get a current snapshot,
        //starting streams up just to retrieve one is slow and will cause
        //the SDM API to hit a rate limit of creating too many streams
        if ((await this.getVideoProtocol()) === Traits.ProtocolType.RTSP)
            return await fs.promises.readFile(path.join(__dirname, "..", "res", "nest-logo.jpg"));
        else
            return await fs.promises.readFile(path.join(__dirname, "..", "res", "google-logo.jpg"));
    }

    getResolutions(): [number, number, number][] {
        return [
            [320, 180, 30],
            [320, 240, 15], // Apple Watch requires this configuration
            [320, 240, 30],
            [480, 270, 30],
            [480, 360, 30],
            [640, 360, 30],
            [640, 480, 30],
            [1280, 720, 30],
            [1280, 960, 30],
            [1920, 1080, 30],
            [1600, 1200, 30]
        ];
    }

    async getEventImage(eventId: string, date: Date): Promise<void> {

        const dateDiff = (Date.now() - date.getTime())/1000;
        if (dateDiff > Camera.MAX_EVENT_AGE_SECONDS) {
            this.log.debug(`Camera event image is too old (${dateDiff} sec), ignoring.`, this.getDisplayName());
            return;
        }

        try {
            const generateResponse = await this.executeCommand<Commands.CameraEventImage_GenerateImage, Responses.GenerateImage>(Commands.Constants.CameraEventImage_GenerateImage, {
                eventId: eventId
            });

            if (!generateResponse) return;

            const imageResponse = await axios.get(generateResponse.url, {
                headers: {
                    'Authorization': 'Basic ' + generateResponse.token
                },
                responseType: 'text',
                responseEncoding: 'base64'
            });
            this.image = Buffer.from(imageResponse.data, 'base64');
            setTimeout(() => this.image = null, 10000);
        } catch (error: any) {
            this.log.error(`Could not execute event image GET request: ${describeApiError(error)}`, this.getDisplayName());
        }
    }

    async getCameraLiveStream(): Promise<Traits.CameraLiveStream | null> {
        return await this.getTrait<Traits.CameraLiveStream>(Traits.Constants.CameraLiveStream);
    }

    async getVideoProtocol(): Promise<Traits.ProtocolType> {
        if ((await this.getCameraLiveStream())?.supportedProtocols.includes(Traits.ProtocolType.WEB_RTC)) {
            return Traits.ProtocolType.WEB_RTC;
        } else {
            return Traits.ProtocolType.RTSP;
        }
    }

    async generateStream(params?: string): Promise<GenerateRtspStream | GenerateWebRtcStream | undefined> {
        if ((await this.getVideoProtocol()) === Traits.ProtocolType.WEB_RTC) {
            if (!params)
                throw new Error('Must specify params for WebRTC streams.');
            return this.executeCommand<CameraLiveStream_GenerateWebRtcStream, GenerateWebRtcStream>(Commands.Constants.CameraLiveStream_GenerateWebRtcStream, {
                offerSdp: params
            })
        } else {
            return this.executeCommand<null, GenerateRtspStream>(Commands.Constants.CameraLiveStream_GenerateRtspStream)
        }
    }

    async stopStream(id: string): Promise<void> {
        if ((await this.getVideoProtocol()) === Traits.ProtocolType.WEB_RTC) {
            await this.executeCommand<Commands.CameraLiveStream_StopWebRtcStream, null>(Commands.Constants.CameraLiveStream_StopWebRtcStream, {
                mediaSessionId: id
            });
        } else {
            await this.executeCommand<Commands.CameraLiveStream_StopRtspStream, null>(Commands.Constants.CameraLiveStream_StopRtspStream, {
                streamExtensionToken: id
            });
        }
    }

    protected isEventStale(event: Events.Event): boolean {
        const ageSeconds = (Date.now() - new Date(event.timestamp).getTime())/1000;

        // Both a missing timestamp and an unparseable one land here: new Date(undefined)
        // and new Date('nonsense') each yield NaN from getTime(). Fail OPEN in that case
        // — treat the event as fresh and let it through. A malformed or absent timestamp
        // must never be able to silently swallow real motion or a doorbell ring; the cost
        // of being wrong that way is a missed alert, versus a duplicate one the other way.
        if (Number.isNaN(ageSeconds)) return false;

        if (ageSeconds > Camera.MAX_EVENT_AGE_SECONDS) {
            this.log.debug(`Camera event is too old (${ageSeconds} sec), ignoring.`, this.getDisplayName());
            return true;
        }

        return false;
    }

    event(event: ResourceEventEvent): void {
        super.event(event);
        if (this.isEventStale(event)) return;

        _.forEach(event.resourceUpdate.events, (value, key) => {
            switch (key) {
                case Events.Constants.CameraMotion:
                case Events.Constants.CameraPerson:

                    if (event.eventThreadState && event.eventThreadState != ThreadStateType.STARTED)
                        return;

                    this.getVideoProtocol()
                        .then(protocol => {
                            if (protocol === Traits.ProtocolType.WEB_RTC) {
                                if (this.onMotion)
                                    this.onMotion();
                            } else {
                                this.getEventImage((value as Events.CameraMotion).eventId, new Date(event.timestamp))
                                    .then(() => {
                                        if (this.onMotion)
                                            this.onMotion();
                                    });
                            }
                        });
                    break;
                case Events.Constants.CameraSound:

                    if (event.eventThreadState && event.eventThreadState != ThreadStateType.STARTED)
                        return;

                    this.getVideoProtocol()
                        .then(protocol => {
                            if (protocol === Traits.ProtocolType.RTSP) {
                                this.getEventImage((value as Events.CameraSound).eventId, new Date(event.timestamp));
                            }
                        });
                    break;
            }
        });
    }
}
