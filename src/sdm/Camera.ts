import {Device} from './Device';
import {GenerateRtspStream} from './Responses';
import {ResourceEventEvent} from './Events';
import * as Commands from './Commands';

export class Camera extends Device {
    getResolutions(): [number, number, number][] {
        return [[1280, 720, 15],[1920, 1080, 15]];
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
