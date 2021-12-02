import {Device} from './Device';
import {GenerateRtspStream} from './Responses';
import {ResourceEventEvent} from './Events';
import * as Commands from './Commands';
import axios from 'axios';
import fs from "fs";
import path from "path";
import * as Responses from "./Responses";
import {ImageQueue} from "./ImageQueue";
import _ from "lodash";
import * as Events from "./Events";
import * as Traits from "./Traits";

export class Camera extends Device {

    getDisplayName(): string {
        return this.displayName ? this.displayName + ' Camera' : 'Unknown';
    }

    onMotion: (() => void) | undefined;
    private imageQueue: ImageQueue = new ImageQueue(this.getDisplayName(), this.log);

    async getSnapshot(): Promise<Buffer | undefined> {
        const image = this.imageQueue.get();
        if (image) return image;

        //Nest cams do not have any method to get a current snapshot,
        //starting streams up just to retrieve one is slow and will cause
        //the SDM API to hit a rate limit of creating too many streams
        const camaraInfo = await this.getCameraLiveStream();
        if (camaraInfo?.supportedProtocols.includes(Traits.ProtocolType.RTSP))
            return await fs.promises.readFile(path.join(__dirname, "..", "res", "nest-logo.jpg"))
        else
            return await fs.promises.readFile(path.join(__dirname, "..", "res", "google-logo.jpg"))
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

        if (Date.now() - date.getTime() > 30 * 1000) {
            this.log.debug('Camera event image is too old, ignoring.', this.getDisplayName());
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
                responseType: 'arraybuffer'
            });
            const buffer = Buffer.from(imageResponse.data, 'binary');
            this.imageQueue.put(buffer);
        } catch (error: any) {
            this.log.error('Could not execute event image GET request: ', JSON.stringify(error), this.getDisplayName());
        }
    }

    async getCameraLiveStream(): Promise<Traits.CameraLiveStream | null> {
        return await this.getTrait<Traits.CameraLiveStream>(Traits.Constants.CameraLiveStream);
    }

    async getStreamInfo(): Promise<GenerateRtspStream | undefined> {
        return this.executeCommand<null, GenerateRtspStream>(Commands.Constants.CameraLiveStream_GenerateRtspStream)
    }

    async stopStream(extensionToken: string): Promise<void> {
        await this.executeCommand<Commands.CameraLiveStream_StopRtspStream, GenerateRtspStream>(Commands.Constants.CameraLiveStream_StopRtspStream, {
            streamExtensionToken: extensionToken
        });
    }

    event(event: ResourceEventEvent): void {
        super.event(event);
        _.forEach(event.resourceUpdate.events, (value, key) => {
            switch (key) {
                case Events.Constants.CameraMotion:
                    this.getEventImage((value as Events.CameraMotion).eventId, new Date(event.timestamp))
                        .then(() => {
                            if (this.onMotion)
                                this.onMotion();
                        });
                    break;
                case Events.Constants.CameraPerson:
                    this.getEventImage((value as Events.CameraPerson).eventId, new Date(event.timestamp))
                        .then(() => {
                            if (this.onMotion)
                                this.onMotion();
                        });
                    break;
                case Events.Constants.CameraSound:
                    this.getEventImage((value as Events.CameraSound).eventId, new Date(event.timestamp));
                    break;
            }
        });
    }
}
