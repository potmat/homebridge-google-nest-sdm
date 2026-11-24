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
import {Readable} from 'stream';
import os from 'os';
import {networkInterfaceDefault} from 'systeminformation';
import {Config} from './Config'
import {FfmpegProcess} from './FfMpegProcess';
import {Camera} from "./sdm/Camera";
import {getStreamer, NestStream, NestStreamer} from "./NestStreamer";
import {Platform} from "./Platform";
import HksvStreamer from "./HksvStreamer";
import {getPrebufferManager, PrebufferManager} from "./PrebufferManager";
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
  streamId: number,
  // Undefined on the prebuffer path: the ring already owns a stream from the local
  // restreamer, so there is no per-recording SDM session to tear down.
  nestStreamer?: NestStreamer,
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

    // Start the ring NOW, not on the first updateRecordingActive(true). It exists to hold
    // footage from BEFORE a trigger, so a ring that only warms once HomeKit toggles
    // recording is empty at exactly the moment it is first needed. updateRecordingActive
    // still stops it when the user turns recording off for a camera, and starts it again
    // when they turn it back on.
    try {
      const key = this.prebufferKey();
      const manager = this.prebufferManager();
      if (key && manager && (this.config.prebufferSeconds || 0) > 0) {
        manager.ensure(key);
        this.log.info(`[prebuffer:${key}] ring started (${this.config.prebufferSeconds}s pre-roll configured)`);
      }
    } catch (e) {
      this.log.error('Prebuffer could not be started: ' + e, this.camera.getDisplayName());
    }

    api.on(APIEvent.SHUTDOWN, () => {
      for (const session in this.ongoingSessions) {
        this.stopStream(session);
      }
      // Stop the prebuffer rings too. Their reader ffmpegs would otherwise outlive the
      // bridge until they happen to take a SIGPIPE.
      this.prebufferManager()?.stopAll();
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
          // Advertise the pre-roll we can actually serve. HomeKit does not merely bound its
          // request by this value, it TRIMS the stored clip to it: a measured event
          // (2026-07-29 16:06) had ~11s of history served and the kept clip began at exactly
          // trigger-minus-4s, with everything earlier discarded. Leaving this at 4000 while
          // the ring serves 15s therefore throws away most of what the feature exists to
          // recover — and since the recording request itself arrives seconds AFTER the event
          // timestamp, a 4s ceiling means the median clip still starts after the subject has
          // gone, which is the whole defect.
          //
          // Unchanged at 4000 when the prebuffer is off, so nobody who hasn't enabled it sees
          // a different advertisement. (That the stock value promises 4s of pre-trigger
          // footage the plugin has never delivered is a separate issue — potmat#233.)
          prebufferLength: this.advertisedPrebufferLength(),
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

    const nestStreamer = await getStreamer(this.log, this.camera, this.config);

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
    // Only tear down if this close targets the session we're actually running. A HomeKit hub can
    // send a late close for an already-replaced (orphaned) session; without this guard that stale
    // close would destroy the *current* recording.
    if (this.recordingSessionInfo && this.recordingSessionInfo.streamId !== streamId) {
      this.log.debug(`Ignoring recording close for a stale/replaced session id ${streamId}.`, this.camera.getDisplayName());
      return;
    }
    if (this.recordingSessionInfo?.hksvStreamer) {
      this.recordingSessionInfo?.hksvStreamer.destroy();
      // teardown() is async; an unhandled rejection here would restart the bridge on Node >= 15.
      Promise.resolve(this.recordingSessionInfo.nestStreamer?.teardown()).catch(e => this.log.error('Error tearing down recording SDM stream: ' + e, this.camera.getDisplayName()));
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

    // PREBUFFER: when configured, feed the encoder from the rolling in-memory ring so
    // the clip begins BEFORE the trigger. Measured 2026-07-29: Google Home's own clip
    // for an event began 6.1s before the SDM timestamp Google gave us, and our first
    // frame landed 3.6s after it -- a ~9.7s gap during which the subject walks out of
    // shot, leaving HomeKit's People/Animals/Vehicles analysis nothing to find, so it
    // discards the clip with no error reported at any layer.
    //
    // Falls back to the normal SDM dial whenever the ring is not ready, so a cold start,
    // a restreamer restart or a camera that is switched off all degrade to exactly the
    // behaviour of this plugin with the feature disabled.
    let nestStreamer: NestStreamer | undefined;
    let nestStream: NestStream;

    const prebufferStream = this.createPrebufferStream();
    if (prebufferStream) {
      nestStream = {args: "-f mp4 -i pipe:0", stdinStream: prebufferStream};
    } else {
      nestStreamer = await getStreamer(this.log, this.camera, this.config);
      nestStream = await nestStreamer.initialize();
    }

    const hksvStreamer = new HksvStreamer(
        this.log,
        nestStream,
        audioArgs,
        videoArgs,
        this.platform.debugMode
    );

    // Tear down any prior recording session before overwriting it. A HomeKit hub
    // can start a new recording (e.g. after a brief reconnect) before the previous
    // session's close event fires. Without this, the previous HksvStreamer — and
    // its ffmpeg child process — is orphaned and never cleaned up, accumulating
    // memory over time. See #150.
    if (this.recordingSessionInfo) {
      this.recordingSessionInfo.hksvStreamer.destroy();
      Promise.resolve(this.recordingSessionInfo.nestStreamer?.teardown()).catch(e => this.log.error('Error tearing down prior recording SDM stream: ' + e, this.camera.getDisplayName()));
    }

    this.recordingSessionInfo = {
      streamId: streamId,
      hksvStreamer: hksvStreamer,
      nestStreamer: nestStreamer
    }

    const pending: Array<Buffer> = [];

    try {
      // start() belongs INSIDE the try. Outside it, a failure to start (port bind,
      // spawn error, destroy racing the listen) threw before the finally existed, so
      // the prebuffer consumer stayed subscribed and its queue grew until the
      // 240-fragment backstop destroyed it minutes later. Inside, the finally below
      // releases it immediately on every failure path.
      await hksvStreamer.start();
      if (!hksvStreamer || hksvStreamer.destroyed) {
        throw new Error('Streaming server already closed.')
      }

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
    } finally {
      // Release this recording's ring subscription HERE rather than relying on the hub.
      // hap-nodejs does eventually call closeRecordingStream — on a generator throw
      // immediately, but on a clean return without isLast only via a ~12s timeout — and
      // until it does, a finished recording keeps a subscriber attached and its queue
      // filling at ~150KB/s. Destroying the source is idempotent and also ends ffmpeg's
      // stdin, so the child exits instead of waiting on input that will never come.
      try {
        prebufferStream?.destroy();
      } catch (e) { /* already gone */ }
    }
  }

  /**
   * This camera's stream name on the local RTSP restreamer, or undefined when the
   * prebuffer is not configured. Defaults to a slug of the name Google reports
   * ("Front Door" -> front_door); override with `prebufferStreamNames` when the
   * restreamer names its streams differently.
   */
  protected prebufferKey(): string | undefined {
    if (!this.config.prebufferRtspBase)
      return undefined;

    const sourceName = this.camera.getSourceName();

    // A configured override is used VERBATIM. It exists precisely for stream names the slug
    // rule cannot produce — Home Assistant's bundled go2rtc names streams `camera.front_door`,
    // and dots, dashes and capitals are all destroyed by the slug. Slugifying the user's own
    // value would leave no way to express those names at all, and the symptom is silent: the
    // ring 404s forever, backs off to the five-minute cap, and every recording quietly falls
    // back to a direct dial with no indication the override was ignored.
    const configured = this.config.prebufferStreamNames?.[sourceName];
    if (configured)
      return configured;

    const key = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return key || undefined;
  }

  /**
   * The `prebufferLength` to advertise to HomeKit. Bounded at 15s: the hub treats this as the
   * amount of pre-trigger footage to KEEP, and advertising more than the ring retains would
   * promise history that does not exist.
   */
  protected advertisedPrebufferLength(): number {
    const seconds = this.config.prebufferSeconds || 0;
    if (!this.config.prebufferRtspBase || seconds <= 0)
      return 4000;

    // Never advertise more history than the ring actually retains. The two values are
    // independent config fields and JSON Schema cannot express "this one must not exceed
    // that one", so nothing stops a 15s pre-roll on a 5s ring. Since the hub KEEPS what we
    // advertise, that combination promises 15s and delivers 5 — silently, because every
    // layer reports success. Clamp to the smaller of the two.
    const retained = this.config.prebufferRetainSeconds || 15;
    return Math.min(seconds * 1000, retained * 1000, 15000);
  }

  protected prebufferManager(): PrebufferManager | undefined {
    if (!this.config.prebufferRtspBase)
      return undefined;

    return getPrebufferManager(
        this.log,
        require('ffmpeg-for-homebridge') || 'ffmpeg',
        this.config.prebufferRtspBase,
        this.config.prebufferRetainSeconds
    );
  }

  /**
   * A Readable carrying [pre-trigger history][live], or undefined to fall back to a
   * normal SDM dial. Never throws: a prebuffer failure must cost pre-trigger footage,
   * not the recording.
   */
  protected createPrebufferStream(): Readable | undefined {
    const prebufferSeconds = this.config.prebufferSeconds || 0;
    if (prebufferSeconds <= 0)
      return undefined;

    const key = this.prebufferKey();
    const manager = this.prebufferManager();
    if (!key || !manager)
      return undefined;

    try {
      // Serve what the hub SELECTED, not what we advertised. Our value is only an upper
      // bound; anything beyond the selection is encoded and then discarded.
      const selectedMs = this.cameraRecordingConfiguration?.prebufferLength || 0;
      // One fragment (~1.67s) of slack: fragments are stamped when they COMPLETE, so the
      // one containing the anchor instant would otherwise be filtered out.
      const requestedMs = Math.min(selectedMs > 0 ? selectedMs + 2000 : prebufferSeconds * 1000, prebufferSeconds * 1000);

      // Clamp the anchor. lastEventTimestamp is never cleared, and is not latched at all
      // for a doorbell-chime-triggered recording, so it can be hours old -- which would
      // make the ring's `t >= since` filter pass EVERY buffered fragment and maximise the
      // backlog handed to the encoder. Never reach back more than 30s.
      const anchor = Math.max(this.camera.lastEventTimestamp || Date.now(), Date.now() - 30000);

      const stream = manager.createStream(key, anchor - requestedMs);
      if (stream)
        this.log.debug(`Prebuffer: hub selected ${selectedMs}ms, serving ${requestedMs}ms`, this.camera.getDisplayName());
      return stream || undefined;
    } catch (e) {
      this.log.error('Prebuffer unavailable, falling back to a direct dial: ' + e, this.camera.getDisplayName());
      return undefined;
    }
  }

  updateRecordingActive(active: boolean): void {
    this.log.debug("Recording active set to " + active);

    // Stop holding video in RAM for a camera whose HKSV recording the user has switched
    // off, and resume when they switch it back on. The ring is started here rather than
    // lazily at trigger time because it exists to hold history from BEFORE a trigger --
    // creating it on demand would leave it empty precisely when it is needed.
    try {
      const key = this.prebufferKey();
      const manager = this.prebufferManager();
      if (!key || !manager || (this.config.prebufferSeconds || 0) <= 0)
        return;

      if (active) {
        manager.ensure(key);
      } else {
        this.log.info(`[prebuffer:${key}] HKSV recording disabled for this camera; stopping ring`);
        manager.release(key);
      }
    } catch (e) {
      this.log.error('Prebuffer updateRecordingActive failed: ' + e, this.camera.getDisplayName());
    }
  }

  updateRecordingConfiguration(configuration: CameraRecordingConfiguration | undefined): void {
    this.cameraRecordingConfiguration = configuration;
  }
}