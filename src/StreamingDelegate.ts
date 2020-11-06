import {
  API,
  APIEvent,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraController,
  CameraControllerOptions,
  CameraStreamingDelegate,
  HAP,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  VideoInfo,
  Logger
} from 'homebridge';
import { createSocket, Socket } from 'dgram';
import getPort from 'get-port';
import os from 'os';
import { networkInterfaceDefault } from 'systeminformation';
import { Config } from './Config'
import { FfmpegProcess } from './FfMpeg';
import {Camera, StreamInfo} from "./SdmApi";

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

type ResolutionInfo = {
  width: number;
  height: number;
  videoFilter: string;
};

type ActiveSession = {
  mainProcess?: FfmpegProcess;
  returnProcess?: FfmpegProcess;
  timeout?: NodeJS.Timeout;
  socket?: Socket;
  streamInfo: StreamInfo;
};

export class StreamingDelegate implements CameraStreamingDelegate {
  private readonly hap: HAP;
  private readonly log: Logger;
  private readonly videoProcessor: string;
  readonly controller: CameraController;

  // keep track of sessions
  pendingSessions: Record<string, SessionInfo> = {};
  ongoingSessions: Record<string, ActiveSession> = {};
  timeouts: Record<string, NodeJS.Timeout> = {};
  private config: Config;
  private camera: Camera;
  private debug: boolean = true;

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

    const options: CameraControllerOptions = {
      cameraStreamCount: 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: camera.getResolutions(),
          codec: {
            profiles: [this.hap.H264Profile.BASELINE, this.hap.H264Profile.MAIN, this.hap.H264Profile.HIGH],
            levels: [this.hap.H264Level.LEVEL3_1, this.hap.H264Level.LEVEL3_2, this.hap.H264Level.LEVEL4_0]
          }
        },
        audio: {
          twoWayAudio: false,
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_24
            }
          ]
        }
      }
    };

    this.controller = new this.hap.CameraController(options);
  }

  private determineResolution(request: VideoInfo): ResolutionInfo {
    let width = request.width;
    let height = request.height;

    const filters: Array<string> = [];
    if (width > 0 || height > 0) {
      filters.push('scale=' + (width > 0 ? '\'min(' + width + ',iw)\'' : 'iw') + ':' +
          (height > 0 ? '\'min(' + height + ',ih)\'' : 'ih') +
          ':force_original_aspect_ratio=decrease');
      filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2'); // Force to fit encoder restrictions
    }

    return {
      width: width,
      height: height,
      videoFilter: filters.join(',')
    };
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    //Nest cams do not have any method to get a current snapshot,
    //starting streams up just to retrieve one is slow and will cause
    //the SDM API to hit a rate limit of creating too many streams
    callback(undefined, undefined);
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
    const vEncoder = this.config.vEncoder;
    const vDecoder = this.config.vDecoder;
    const aEncoder = this.config.aEncoder;
    const aDecoder = this.config.aDecoder;
    const mtu = 1316; // request.video.mtu is not used
    // const encoderOptions = vEncoder === 'libx264' ? '-preset ultrafast -tune zerolatency' : '';
    // const resolution = this.determineResolution(request.video);
    // let fps = 15;//request.video.fps;
    // let videoBitrate = request.video.max_bit_rate;

    // if (vEncoder === 'copy') {
    //   resolution.width = 0;
    //   resolution.height = 0;
    //   resolution.videoFilter = '';
    //   fps = 0;
    //   videoBitrate = 0;
    // }

    // this.log.debug('Video stream requested: ' + request.video.width + ' x ' + request.video.height + ', ' +
    //     request.video.fps + ' fps, ' + request.video.max_bit_rate + ' kbps', this.camera.getDisplayName(), this.debug);
    // this.log.info('Starting video stream: ' + (resolution.width > 0 ? resolution.width : 'native') + ' x ' +
    //     (resolution.height > 0 ? resolution.height : 'native') + ', ' + (fps > 0 ? fps : 'native') +
    //     ' fps, ' + (videoBitrate > 0 ? videoBitrate : '???') + ' kbps', this.camera.getDisplayName());

    const streamInfo = await this.camera.getStreamInfo();
    let ffmpegArgs = '-c:a '+ aDecoder + ' -i ' + streamInfo.rtspUrl;

    ffmpegArgs += // Video
        ' -an -sn -dn' +
        ' -codec:v ' + vEncoder +
        // (fps > 0 ? ' -r ' + fps : '') +
        // (encoderOptions ? ' ' + encoderOptions : '') +
        // (resolution.videoFilter.length > 0 ? ' -filter:v ' + resolution.videoFilter : '') +
        // (videoBitrate > 0 ? ' -b:v ' + videoBitrate + 'k' : '') +
        ' -payload_type ' + request.video.pt;

    ffmpegArgs += // Video Stream
        ' -ssrc ' + sessionInfo.videoSSRC +
        ' -f rtp' +
        ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80' +
        ' -srtp_out_params ' + sessionInfo.videoSRTP.toString('base64') +
        ' srtp://' + sessionInfo.address + ':' + sessionInfo.videoPort +
        '?rtcpport=' + sessionInfo.videoPort + '&pkt_size=' + mtu;


      ffmpegArgs += // Audio
          ' -vn -sn -dn' +
          ' -codec:a ' + aEncoder +
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
        // await this.stopStream(request.sessionID);
        // this.startStream(request, callback);
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
      await this.camera.stopStream(session.streamInfo.extensionToken);
    } catch (err) {
      this.log.error('Error terminating SDM stream: ' + err, this.camera.getDisplayName());
    }

    delete this.ongoingSessions[sessionId];
    this.log.info('Stopped video stream.', this.camera.getDisplayName());
  }
}
