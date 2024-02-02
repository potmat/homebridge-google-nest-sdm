import {
  API,
  APIEvent, AudioBitrate, AudioRecordingCodecType, AudioRecordingSamplerate,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  CameraController,
  CameraControllerOptions, CameraRecordingConfiguration, CameraRecordingDelegate,
  CameraStreamingDelegate, H264Level, H264Profile,
  HAP, HDSProtocolSpecificErrorReason,
  Logger, MediaContainerType, PlatformAccessory,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse, RecordingPacket, SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes, VideoInfo
} from 'homebridge';
import { VideoCodecType } from 'hap-nodejs'
import {createSocket, Socket} from 'dgram';
import os from 'os';
import {networkInterfaceDefault} from 'systeminformation';
import {Config} from './Config'
import {FfmpegProcess} from './FfMpegProcess';
import {Camera} from "./sdm/Camera";
import {getStreamer, NestStream, NestStreamer} from "./NestStreamer";
import {Platform} from "./Platform";
import HksvStreamer from "./HksvStreamer";
import pickPort, { pickPortOptions } from 'pick-port';

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
  streamer: NestStreamer;
};

type ResolutionInfo = {
  width: number;
  height: number;
  videoFilter: string;
};

type RecordingSessionInfo = {
  nestStreamer: NestStreamer,
  hksvStreamer: HksvStreamer
}

export abstract class StreamingDelegate<T extends CameraController> implements CameraStreamingDelegate, CameraRecordingDelegate {
  protected hap: HAP;
  protected log: Logger;

  // keep track of sessions
  protected pendingSessions: Record<string, SessionInfo> = {};
  protected ongoingSessions: Record<string, ActiveSession> = {};
  protected config: Config;
  protected accessory: PlatformAccessory;
  protected camera: Camera;
  protected platform: Platform;
  protected options: CameraControllerOptions;
  protected controller!: T;

  // minimal secure video properties.
  protected cameraRecordingConfiguration?: CameraRecordingConfiguration;
  protected handlingRecordingStreamingRequest = false;
  protected recordingSessionInfo?: RecordingSessionInfo;

  constructor(log: Logger, api: API, platform: Platform, camera: Camera, accessory: PlatformAccessory) {
    this.platform = platform;
    this.log = log;
    this.hap = api.hap;
    this.config = platform.platformConfig as unknown as Config
    this.camera = camera;
    this.accessory = accessory;

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
      },
      recording: {
        delegate: this,
        options: {
          prebufferLength: 4000,
          mediaContainerConfiguration: {
            type: MediaContainerType.FRAGMENTED_MP4,
            fragmentLength: 4000,
          },
          video: {
            type: VideoCodecType.H264,
            parameters: {
              profiles: [H264Profile.HIGH],
              levels: [H264Level.LEVEL4_0],
            },
            resolutions: [
              [320, 180, 30],
              [320, 240, 15],
              [320, 240, 30],
              [480, 270, 30],
              [480, 360, 30],
              [640, 360, 30],
              [640, 480, 30],
              [1280, 720, 30],
              [1280, 960, 30],
              [1920, 1080, 30],
              [1600, 1200, 30],
            ],
          },
          audio: {
            codecs: {
              type: AudioRecordingCodecType.AAC_ELD,
              audioChannels: 1,
              samplerate: AudioRecordingSamplerate.KHZ_48,
              bitrateMode: AudioBitrate.VARIABLE,
            },
          },
        }
      }
    };
  }

  abstract getController(): T;

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    this.camera.getSnapshot()
        .then(result => {
          callback(undefined, result);
        })
  }

  private static determineResolution(request: VideoInfo): ResolutionInfo {
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

  /**
   * Some callback methods do not log anything if they are called with an error.
   */
  logThenCallback(callback: (error?: Error) => void, message: string) {
    this.log.error(message);
    callback(new Error(message));
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {

    const camaraInfo = await this.camera.getCameraLiveStream();

    if (!camaraInfo) {
      this.logThenCallback(callback, 'Unable to start stream! Camera info was not received');
      return;
    }

    const ipv6 = request.addressVersion === 'ipv6';

    const options: pickPortOptions = {
      type: 'udp',
      ip: ipv6 ? '::' : '0.0.0.0',
      reserveTimeout: 15
    };
    const videoReturnPort = await pickPort(options);
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const audioReturnPort = await pickPort(options);
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();


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
    const resolution = StreamingDelegate.determineResolution(request.video);
    const bitrate = request.video.max_bit_rate * 4;
    const vEncoder = this.config.vEncoder || 'libx264 -preset ultrafast -tune zerolatency'

    this.log.debug(`Video stream requested: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps`, this.camera.getDisplayName());

    const nestStreamer = await getStreamer(this.log, this.camera);

    let ffmpegArgs: string;
    let nestStream: NestStream;

    try {
      nestStream = await nestStreamer.initialize(); // '-analyzeduration 15000000 -probesize 100000000 -i ' + streamInfo.streamUrls.rtspUrl;
      ffmpegArgs = nestStream.args;
    } catch (error: any) {
      this.logThenCallback(callback, error);
      return;
    }

    ffmpegArgs += // Video
        ' -an -sn -dn' +
        ` -codec:v ${vEncoder}` +
        ' -f rawvideo' +
        ' -pix_fmt yuv420p' +
        ' -color_range mpeg';
    if (vEncoder !== 'copy') {
        ffmpegArgs +=
            ' -bf 0' +
            ` -r ${request.video.fps}` +
            ` -b:v ${bitrate}k` +
            ` -bufsize ${bitrate}k` +
            ` -maxrate ${2 * bitrate}k` +
            ' -filter:v ' + resolution.videoFilter;
    }
    ffmpegArgs += ' -payload_type ' + request.video.pt;

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


    if (this.platform.debugMode) {
      ffmpegArgs += ' -loglevel level+verbose';
    }

    const activeSession: ActiveSession = { streamer: nestStreamer };

    try {
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
          this.log.debug('Device appears to be inactive. Stopping stream.', this.camera.getDisplayName());
          this.controller.forceStopStreamingSession(request.sessionID);
          this.stopStream(request.sessionID);
        }, request.video.rtcp_interval * 2 * 1000);
      });
      activeSession.socket.bind(sessionInfo.videoReturnPort, sessionInfo.localAddress);
    } catch (error: any) {
      this.logThenCallback(callback, error);
      return;
    }

    activeSession.mainProcess = new FfmpegProcess(this.camera.getDisplayName(), request.sessionID, ffmpegArgs, nestStream.stdin, this.log, this.platform.debugMode, this, callback);

    this.ongoingSessions[request.sessionID] = activeSession;
    delete this.pendingSessions[request.sessionID];
  }

  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug(`Received request to reconfigure: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps (Ignored)`, this.camera.getDisplayName());
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
      try {
        await session.streamer.teardown();
      } catch (err) {
        this.log.error('Error terminating SDM stream: ' + err, this.camera.getDisplayName());
      }
    }

    delete this.ongoingSessions[sessionId];
    this.log.debug('Stopped video stream.', this.camera.getDisplayName());
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    if (this.recordingSessionInfo?.hksvStreamer) {
      this.recordingSessionInfo?.hksvStreamer.destroy();
      this.recordingSessionInfo.nestStreamer.teardown();
      this.recordingSessionInfo = undefined;
    }
    this.handlingRecordingStreamingRequest = false;
  }


  acknowledgeStream(streamId: number): void {
    this.closeRecordingStream(streamId, undefined);
  }

  /**
   * This is a very minimal, very experimental example on how to implement fmp4 streaming with a
   * CameraController supporting HomeKit Secure Video.
   *
   * An ideal implementation would diverge from this in the following ways:
   * * It would implement a prebuffer and respect the recording `active` characteristic for that.
   * * It would start to immediately record after a trigger event occurred and not just
   *   when the HomeKit Controller requests it (see the documentation of `CameraRecordingDelegate`).
   */
  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket> {

    this.log.debug('Recording request received.')

    if (!this.cameraRecordingConfiguration)
      throw new Error('No recording configuration for this camera.');

    /**
     * With this flag you can control how the generator reacts to a reset to the motion trigger.
     * If set to true, the generator will send a proper endOfStream if the motion stops.
     * If set to false, the generator will run till the HomeKit Controller closes the stream.
     *
     * Note: In a real implementation you would most likely introduce a bit of a delay.
     */
    const STOP_AFTER_MOTION_STOP = false;

    this.handlingRecordingStreamingRequest = true;

    if (this.cameraRecordingConfiguration.videoCodec.type !== VideoCodecType.H264)
      throw new Error('Unsupported recording codec type.');

    const profile = this.cameraRecordingConfiguration!.videoCodec.parameters.profile === H264Profile.HIGH ? "high"
        : this.cameraRecordingConfiguration!.videoCodec.parameters.profile === H264Profile.MAIN ? "main" : "baseline";

    const level = this.cameraRecordingConfiguration!.videoCodec.parameters.level === H264Level.LEVEL4_0 ? "4.0"
        : this.cameraRecordingConfiguration!.videoCodec.parameters.level === H264Level.LEVEL3_2 ? "3.2" : "3.1";

    const videoArgs: Array<string> = [
      "-an",
      "-sn",
      "-dn",
      "-codec:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",

      "-profile:v", profile,
      "-level:v", level,
      "-b:v", `${this.cameraRecordingConfiguration!.videoCodec.parameters.bitRate}k`,
      "-force_key_frames", `expr:eq(t,n_forced*${this.cameraRecordingConfiguration!.videoCodec.parameters.iFrameInterval / 1000})`,
      "-r", this.cameraRecordingConfiguration!.videoCodec.resolution[2].toString(),
    ];

    let samplerate: string;
    switch (this.cameraRecordingConfiguration!.audioCodec.samplerate) {
      case AudioRecordingSamplerate.KHZ_8:
        samplerate = "8";
        break;
      case AudioRecordingSamplerate.KHZ_16:
        samplerate = "16";
        break;
      case AudioRecordingSamplerate.KHZ_24:
        samplerate = "24";
        break;
      case AudioRecordingSamplerate.KHZ_32:
        samplerate = "32";
        break;
      case AudioRecordingSamplerate.KHZ_44_1:
        samplerate = "44.1";
        break;
      case AudioRecordingSamplerate.KHZ_48:
        samplerate = "48";
        break;
      default:
        throw new Error("Unsupported audio sample rate: " + this.cameraRecordingConfiguration!.audioCodec.samplerate);
    }

    const audioArgs: Array<string> = this.controller?.recordingManagement?.recordingManagementService.getCharacteristic(this.platform.Characteristic.RecordingAudioActive)
        ? [
          "-acodec", "libfdk_aac",
          ...(this.cameraRecordingConfiguration!.audioCodec.type === AudioRecordingCodecType.AAC_LC ?
              ["-profile:a", "aac_low"] :
              ["-profile:a", "aac_eld"]),
          "-ar", `${samplerate}k`,
          "-b:a", `${this.cameraRecordingConfiguration!.audioCodec.bitrate}k`,
          "-ac", `${this.cameraRecordingConfiguration!.audioCodec.audioChannels}`,
        ]
        : [];

    const nestStreamer = await getStreamer(this.log, this.camera);
    const nestStream = await nestStreamer.initialize();
    const hksvStreamer = new HksvStreamer(
        this.log,
        nestStream,
        audioArgs,
        videoArgs,
        this.platform.debugMode
    );

    this.recordingSessionInfo = {
      hksvStreamer: hksvStreamer,
      nestStreamer: nestStreamer
    }

    await hksvStreamer.start();
    if (!hksvStreamer || hksvStreamer.destroyed) {
      throw new Error('Streaming server already closed.')
    }

    const pending: Array<Buffer> = [];

    try {
      for await (const box of this.recordingSessionInfo.hksvStreamer.generator()) {
        pending.push(box.header, box.data);

        const motionDetected = this.accessory.getService(this.hap.Service.MotionSensor)?.getCharacteristic(this.platform.Characteristic.MotionDetected).value;

        this.log.debug("mp4 box type " + box.type + " and length " + box.length);
        if (box.type === "moov" || box.type === "mdat") {
          const fragment = Buffer.concat(pending);
          pending.splice(0, pending.length);

          const isLast = STOP_AFTER_MOTION_STOP && !motionDetected;

          yield {
            data: fragment,
            isLast: isLast,
          };

          if (isLast) {
            this.log.debug("Ending session due to motion stopped!");
            break;
          }
        }
      }
    } catch (error: any) {
      this.log.error("Encountered unexpected error on generator " + error.stack);
    }
  }

  updateRecordingActive(active: boolean): void {
    // we haven't implemented a prebuffer
    this.log.debug("Recording active set to " + active);
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): void {
    this.cameraRecordingConfiguration = configuration;
  }
}