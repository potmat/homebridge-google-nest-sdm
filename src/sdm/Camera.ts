import {Device} from "./Device";
import {GenerateRtspStream} from "./Responses";

export class Camera extends Device {
    getSnapshot(): Buffer|null {
        return null;
    }

    getResolutions(): [number, number, number][] {
        return [[1280, 720, 15],[1920, 1080, 15]];
    }

    async getStreamInfo(): Promise<GenerateRtspStream> {
        return this.executeCommand<null, GenerateRtspStream>('sdm.devices.commands.CameraLiveStream.GenerateRtspStream')


        //
        // return this.smartdevicemanagement.enterprises.devices.executeCommand({
        //     name: this.getName(),
        //     requestBody: {
        //         command: 'sdm.devices.commands.CameraLiveStream.GenerateRtspStream'
        //     }
        // }).then(response => {
        //     return {
        //         rtspUrl: response.data?.results?.streamUrls?.rtspUrl,
        //         token: response.data?.results?.streamToken,
        //         extensionToken: response.data?.results?.streamExtensionToken,
        //         expiresAt: new Date(response.data?.results?.expiresAt)
        //     }
        // })
    }

    async stopStream(extensionToken: string): Promise<any> {
        return this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.getName(),
            requestBody: {
                command: 'sdm.devices.commands.CameraLiveStream.StopRtspStream',
                params: {
                    streamExtensionToken: extensionToken
                }
            }
        }).then(response => {
            return response.data?.results?.streamUrls?.rtspUrl;
        })
    }
}
