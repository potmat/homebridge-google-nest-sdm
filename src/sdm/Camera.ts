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

export class Camera extends Device {

    getDisplayName(): string {
        return this.displayName ? this.displayName + ' Camera' : 'Unknown';
    }

    private imageQueue: ImageQueue = new ImageQueue(this.getDisplayName(), this.log);

    async getSnapshot(): Promise<Buffer | undefined> {
        const image = this.imageQueue.get();
        if (image) return image;

        //Nest cams do not have any method to get a current snapshot,
        //starting streams up just to retrieve one is slow and will cause
        //the SDM API to hit a rate limit of creating too many streams
        return await fs.promises.readFile(path.join(__dirname, "..", "res", "nest-logo.jpg"))
    }

    getResolutions(): [number, number, number][] {
        return [[1280, 720, 15],[1920, 1080, 15]];
    }

    async getEventImage(eventId: string): Promise<void> {
        try {
            const generateResponse = await this.executeCommand<Commands.CameraEventImage_GenerateImage, Responses.GenerateImage>(Commands.Constants.CameraEventImage_GenerateImage, {
                eventId: eventId
            });

            const imageResponse = await axios.get(generateResponse.url, {
                headers: {
                    'Authorization': 'Basic ' + generateResponse.token
                },
                responseType: 'arraybuffer'
            });
            const buffer = Buffer.from(imageResponse.data, 'binary');
            this.imageQueue.put(buffer);
        } catch (error: any) {
            this.log.error(error);
        }
    }

    async getStreamInfo(): Promise<GenerateRtspStream> {
        return this.executeCommand<null, GenerateRtspStream>(Commands.Constants.CameraLiveStream_GenerateRtspStream)
    }

    async stopStream(extensionToken: string): Promise<any> {
        return this.executeCommand<Commands.CameraLiveStream_StopRtspStream, GenerateRtspStream>(Commands.Constants.CameraLiveStream_StopRtspStream, {
            streamExtensionToken: extensionToken
        });
    }

    event(event: ResourceEventEvent): void {
        _.forEach(event.resourceUpdate.events, (value, key) => {
            switch (key) {
                case Events.Constants.CameraMotion:
                    this.getEventImage((value as Events.CameraMotion).eventId);
                    break;
                case Events.Constants.CameraPerson:
                    this.getEventImage((value as Events.CameraPerson).eventId);
                    break;
                case Events.Constants.CameraSound:
                    this.getEventImage((value as Events.CameraSound).eventId);
                    break;
            }
        });
    }
}
