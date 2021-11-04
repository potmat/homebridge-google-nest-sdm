import {Device} from './Device';
import {GenerateRtspStream} from './Responses';
import {ResourceEventEvent} from './Events';
import * as Commands from './Commands';
import axios from 'axios';
import fs from "fs";
import path from "path";
import * as Responses from "./Responses";

export class Camera extends Device {

    private imageQueue: Buffer[] = [];

    async getSnapshot(): Promise<Buffer | undefined> {
        if (this.imageQueue.length > 0)
            return this.imageQueue.shift();

        //Nest cams do not have any method to get a current snapshot,
        //starting streams up just to retrieve one is slow and will cause
        //the SDM API to hit a rate limit of creating too many streams
        return await fs.promises.readFile(path.join(__dirname, "..", "res", "nest-logo.jpg"))
    }

    getResolutions(): [number, number, number][] {
        return [[1280, 720, 15],[1920, 1080, 15]];
    }

    async getEventImage(eventId: string): Promise<void> {
        const generateResponse = await this.executeCommand<Commands.CameraEventImage_GenerateImage, Responses.GenerateImage>(Commands.Constants.CameraEventImage_GenerateImage, {
            eventId: eventId
        });

        try {
            const imageResponse = await axios.get(generateResponse.url, {
                headers: {
                    'Authorization': 'Basic ' + generateResponse.token
                },
                responseType: 'arraybuffer'
            });
            const buffer = Buffer.from(imageResponse.data, 'binary');
            if (this.imageQueue.length > 5)
                this.imageQueue.shift();
            this.imageQueue.push(buffer);
        } catch (error: any) {
            this.log.error(error);
        }
    }

    async getStreamInfo(): Promise<GenerateRtspStream> {
        return this.executeCommand<null, GenerateRtspStream>(Commands.Constants.CameraLiveStream_GenerateRtspStream)
    }

    async stopStream(extensionToken: string): Promise<any> {
        return this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.getName(),
            requestBody: {
                command: Commands.Constants.CameraLiveStream_StopRtspStream,
                params: {
                    streamExtensionToken: extensionToken
                }
            }
        }).then(response => {
            return response.data?.results?.streamUrls?.rtspUrl;
        })
    }

    event(event: ResourceEventEvent): void {
    }
}
