import {
  API,
  APIEvent,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraController,
  CameraControllerOptions,
  CameraStreamingDelegate,
  H264Level,
  HAP,
  Logger,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes
} from 'homebridge';
import {createSocket, Socket} from 'dgram';
import getPort from 'get-port';
import os from 'os';
import fs from 'fs';
import path from 'path';
import {networkInterfaceDefault} from 'systeminformation';
import {Config} from './Config'
import {FfmpegProcess} from './FfMpeg';
import {Camera} from "./sdm/Camera";
import {GenerateRtspStream} from "./sdm/Responses";

type SessionInfo = {
  address: string; // address of the HAP controller
  localAddress: string;
  ipv6: boolean;

  videoPort: number;
  videoReturnPort: number;
  videoCryptoSuite: SRTPCryptoSuites; // should be saved if multiple suites are supported
  videoSRTP: Buffer; // key and salt concatenated
  videoSSRC: number; // rtp synchronisation source

  audioPort: number;
  audioReturnPort: number;
  audioCryptoSuite: SRTPCryptoSuites;
  audioSRTP: Buffer;
  audioSSRC: number;
};

type ActiveSession = {
  mainProcess?: FfmpegProcess;
  returnProcess?: FfmpegProcess;
  timeout?: NodeJS.Timeout;
  socket?: Socket;
  streamInfo: GenerateRtspStream;
};

export abstract class StreamingDelegate<T extends CameraController> implements CameraStreamingDelegate {
  protected hap: HAP;
  protected log: Logger;
  protected videoProcessor: string;

  // keep track of sessions
  protected pendingSessions: Record<string, SessionInfo> = {};
  protected ongoingSessions: Record<string, ActiveSession> = {};
  protected timeouts: Record<string, NodeJS.Timeout> = {};
  protected config: Config;
  protected camera: Camera;
  protected debug: boolean = true;
  protected options: CameraControllerOptions;
  protected controller!: T;

  constructor(log: Logger, api: API, config: Config, camera: Camera) {
    this.log = log;
    this.hap = api.hap;
    this.config = config;
    this.camera = camera;
    this.videoProcessor = 'ffmpeg';

    api.on(APIEvent.SHUTDOWN, () => {
      for (const session in this.ongoingSessions) {
        this.stopStream(session);
      }
    });

    this.options = {
      cameraStreamCount: camera.getResolutions().length, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: camera.getResolutions(),
          codec: {
            profiles: [this.hap.H264Profile.MAIN],
            levels: [this.hap.H264Level.LEVEL3_1]
          }
        },
        audio: {
          twoWayAudio: false,
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_16,
              audioChannels: 1
            }
          ]
        }
      }
    };
  }

  abstract getController(): T;

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    //Nest cams do not have any method to get a current snapshot,
    //starting streams up just to retrieve one is slow and will cause
    //the SDM API to hit a rate limit of creating too many streams
    fs.readFile(path.join(__dirname, "res", "nest-logo.jpg"), (err, data) => {
      if (err) {
        this.log.error(err.message);
        callback(new Error(err.message), undefined);
      } else {
        callback(undefined, data);
      }
    });
  }

  async getIpAddress(ipv6: boolean): Promise<string> {

    const interfaceName = await networkInterfaceDefault();
    const interfaces = os.networkInterfaces();
    // @ts-ignore
    const externalInfo = interfaces[interfaceName]?.filter((info: { internal: any; }) => {
      return !info.internal;
    });
    const preferredFamily = ipv6 ? 'IPv6' : 'IPv4';
    const addressInfo = externalInfo?.find((info: { family: string; }) => {
      return info.family === preferredFamily;
    }) || externalInfo?.[0];
    if (!addressInfo) {
      throw new Error('Unable to get network address for "' + interfaceName + '"!');
    }
    return addressInfo.address;
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    const videoReturnPort = await getPort();
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const audioReturnPort = await getPort();
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    const ipv6 = request.addressVersion === 'ipv6';
    const currentAddress = await this.getIpAddress(ipv6);

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      localAddress: currentAddress,
      ipv6: ipv6,

      videoPort: request.video.port,
      videoReturnPort: videoReturnPort,
      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC: videoSSRC,

      audioPort: request.audio.port,
      audioReturnPort: audioReturnPort,
      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC: audioSSRC
    };

    const response: PrepareStreamResponse = {
      address: currentAddress,
      video: {
        port: videoReturnPort,
        ssrc: videoSSRC,

        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt
      },
      audio: {
        port: audioReturnPort,
        ssrc: audioSSRC,

        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt
      }
    };

    this.pendingSessions[request.sessionID] = sessionInfo;
    callback(undefined, response);
  }

  private async startStream(request: StartStreamRequest, callback: StreamRequestCallback): Promise<void> {
    const sessionInfo = this.pendingSessions[request.sessionID];

    this.log.info('Video stream requested: ' + request.video.width + ' x ' + request.video.height + ', ' +
        request.video.fps + ' fps, ' + request.video.max_bit_rate + ' kbps', this.camera.getDisplayName(), this.debug);

    const streamInfo = await this.camera.getStreamInfo();
    let ffmpegArgs = '-use_wallclock_as_timestamps 1 -fflags +discardcorrupt+nobuffer -i ' + streamInfo.streamUrls.rtspUrl;

    ffmpegArgs += // Video
        ' -an -sn -dn' +
        ' -codec:v copy' +
        ' -copyts -muxdelay 0 -muxpreload 0 ' +
        ' -payload_type ' + request.video.pt;

    ffmpegArgs += // Video Stream
        ' -ssrc ' + sessionInfo.videoSSRC +
        ' -f rtp' +
        ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
        ' -srtp_out_params ' + sessionInfo.videoSRTP.toString('base64') +
        ' srtp://' + sessionInfo.address + ':' + sessionInfo.videoPort +
        '?rtcpport=' + sessionInfo.videoPort + '&pkt_size=' + request.video.mtu;


      ffmpegArgs += // Audio
          ' -vn -sn -dn' +
          ' -codec:a libfdk_aac' +
          ' -profile:a aac_eld' +
          ' -flags +global_header' +
          ' -ar ' + request.audio.sample_rate + 'k' +
          ' -b:a ' + request.audio.max_bit_rate + 'k' +
          ' -ac ' + request.audio.channel +
          ' -payload_type ' + request.audio.pt;

      ffmpegArgs += // Audio Stream
          ' -ssrc ' + sessionInfo.audioSSRC +
          ' -f rtp' +
          ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
          ' -srtp_out_params ' + sessionInfo.audioSRTP.toString('base64') +
          ' srtp://' + sessionInfo.address + ':' + sessionInfo.audioPort +
          '?rtcpport=' + sessionInfo.audioPort + '&pkt_size=188';


    if (this.debug) {
      ffmpegArgs += ' -loglevel level+verbose';
    }

    const activeSession: ActiveSession = { streamInfo: streamInfo };

    activeSession.socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');
    activeSession.socket.on('error', (err: Error) => {
      this.log.error('Socket error: ' + err.name, this.camera.getDisplayName());
      this.stopStream(request.sessionID);
    });
    activeSession.socket.on('message', () => {
      if (activeSession.timeout) {
        clearTimeout(activeSession.timeout);
      }
      activeSession.timeout = setTimeout(() => {
        this.log.info('Device appears to be inactive. Stopping stream.', this.camera.getDisplayName());
        this.controller.forceStopStreamingSession(request.sessionID);
        this.stopStream(request.sessionID);
      }, request.video.rtcp_interval * 2 * 1000);
    });
    activeSession.socket.bind(sessionInfo.videoReturnPort, sessionInfo.localAddress);

    activeSession.mainProcess = new FfmpegProcess(this.camera.getDisplayName(), request.sessionID, this.videoProcessor,
        ffmpegArgs, this.log, this.debug, this, callback);

    this.ongoingSessions[request.sessionID] = activeSession;
    delete this.pendingSessions[request.sessionID];
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug('Received request to reconfigure: ' + request.video.width + ' x ' + request.video.height + ', ' +
            request.video.fps + ' fps, ' + request.video.max_bit_rate + ' kbps (Ignored)', this.camera.getDisplayName(), this.debug);
        callback();
        break;
      case StreamRequestTypes.STOP:
        await this.stopStream(request.sessionID);
        callback();
        break;
    }
  }

  public async stopStream(sessionId: string): Promise<void> {
    const session = this.ongoingSessions[sessionId];
    if (session) {
      if (session.timeout) {
        clearTimeout(session.timeout);
      }
      try {
        session.socket?.close();
      } catch (err) {
        this.log.error('Error occurred closing socket: ' + err, this.camera.getDisplayName());
      }
      try {
        session.mainProcess?.stop();
      } catch (err) {
        this.log.error('Error occurred terminating main FFmpeg process: ' + err, this.camera.getDisplayName());
      }
      try {
        session.returnProcess?.stop();
      } catch (err) {
        this.log.error('Error occurred terminating two-way FFmpeg process: ' + err, this.camera.getDisplayName());
      }
    }

    try {
      await this.camera.stopStream(session.streamInfo.streamExtensionToken);
    } catch (err) {
      this.log.error('Error terminating SDM stream: ' + err, this.camera.getDisplayName());
    }

    delete this.ongoingSessions[sessionId];
    this.log.info('Stopped video stream.', this.camera.getDisplayName());
  }
}
