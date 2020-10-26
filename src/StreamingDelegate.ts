import ip from "ip";
import {ChildProcess, spawn} from "child_process";
import {
  CameraController,
  CameraStreamingDelegate,
  HAP,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  SRTPCryptoSuites,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  StreamSessionIdentifier,
  VideoInfo
} from "homebridge";
import {Camera, StreamInfo} from "./SdmApi";
import {Config} from "./Config";

type SessionInfo = {
  address: string, // address of the HAP controller

  videoPort: number,
  videoCryptoSuite: SRTPCryptoSuites, // should be saved if multiple suites are supported
  videoSRTP: Buffer, // key and salt concatenated
  videoSSRC: number, // rtp synchronisation source

  /* Won't be save as audio is not supported by this example
  audioPort: number,
  audioCryptoSuite: SRTPCryptoSuites,
  audioSRTP: Buffer,
  audioSSRC: number,
   */
}

type ActiveStream = {
  streamInfo: StreamInfo,
  ffmpeg: ChildProcess
}

const FFMPEGH264ProfileNames = [
  "baseline",
  "main",
  "high"
];
const FFMPEGH264LevelNames = [
  "3.1",
  "3.2",
  "4.0"
];

export class StreamingDelegate implements CameraStreamingDelegate {

  private ffmpegDebugOutput: boolean = true;
  controller?: CameraController;

  // keep track of sessions
  pendingSessions: Record<string, SessionInfo> = {};
  ongoingSessions: Record<string, ActiveStream> = {};


  constructor(private readonly hap: HAP,
              private readonly config: Config,
              private readonly device: Camera) {}

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    const ffmpegCommand = `-f lavfi -i testsrc=s=${request.width}x${request.height} -vframes 1 -f mjpeg -`;
    const ffmpeg = spawn("ffmpeg", ffmpegCommand.split(" "), {env: process.env});

    const snapshotBuffers: Buffer[] = [];

    ffmpeg.stdout.on('data', data => snapshotBuffers.push(data));
    ffmpeg.stderr.on('data', data => {
      if (this.ffmpegDebugOutput) {
        console.log("SNAPSHOT: " + String(data));
      }
    });

    ffmpeg.on('exit', (code, signal) => {
      if (signal) {
        console.log("Snapshot process was killed with signal: " + signal);
        callback(new Error("killed with signal " + signal));
      } else if (code === 0) {
        console.log(`Successfully captured snapshot at ${request.width}x${request.height}`);
        callback(undefined, Buffer.concat(snapshotBuffers));
      } else {
        console.log("Snapshot process exited with code " + code);
        callback(new Error("Snapshot process exited with code " + code));
      }
    });
  }

  // called when iOS request rtp setup
  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    const sessionId: StreamSessionIdentifier = request.sessionID;
    const targetAddress = request.targetAddress;

    const video = request.video;
    const videoPort = video.port;

    const videoCryptoSuite = video.srtpCryptoSuite; // could be used to support multiple crypto suite (or support no suite for debugging)
    const videoSrtpKey = video.srtp_key;
    const videoSrtpSalt = video.srtp_salt;

    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: targetAddress,
      videoPort: videoPort,
      videoCryptoSuite: videoCryptoSuite,
      videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
      videoSSRC: videoSSRC,
    };

    const currentAddress = ip.address("public", request.addressVersion); // ipAddress version must match
    const response: PrepareStreamResponse = {
      address: currentAddress,
      video: {
        port: videoPort,
        ssrc: videoSSRC,

        srtp_key: videoSrtpKey,
        srtp_salt: videoSrtpSalt,
      },
      // audio is omitted as we do not support audio in this example
    };

    this.pendingSessions[sessionId] = sessionInfo;
    callback(undefined, response);
  }

  private getVideoCodecCommand(codec: string) : string {
    switch (codec) {
      case 'libx264':
        return '-c:v libx264 -pix_fmt yuv420p -preset ultrafast -tune zerolatency ';
      case 'h264_videotoolbox':
        return '-c:v h264_videotoolbox -pix_fmt yuv420p ';
      default:
        throw 'Video codec not specified';
    }
  }

  private getVideoCommand(video: VideoInfo, sessionInfo: SessionInfo, streamInfo: StreamInfo) : string {
    const profile = FFMPEGH264ProfileNames[video.profile];
    const level = FFMPEGH264LevelNames[video.level];
    const width = video.width;
    const height = video.height;
    const fps = video.fps;

    const payloadType = video.pt;
    const maxBitrate = video.max_bit_rate;
    const rtcpInterval = video.rtcp_interval; // usually 0.5
    const mtu = video.mtu; // maximum transmission unit

    const address = sessionInfo.address;
    const videoPort = sessionInfo.videoPort;
    const ssrc = sessionInfo.videoSSRC;
    const cryptoSuite = sessionInfo.videoCryptoSuite;
    const videoSRTP = sessionInfo.videoSRTP.toString("base64");

    return `-i ${streamInfo.rtspUrl} ` +
        this.getVideoCodecCommand(this.config.vcodec) +
        `-r ${fps} -an -sn -dn -b:v ${maxBitrate}k -bufsize ${2*maxBitrate}k -maxrate ${maxBitrate}k ` +
        `-vf scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease ` +
        `-payload_type ${payloadType} -ssrc ${ssrc} -f rtp ` + // -profile:v ${profile} -level:v ${level}
        `-srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${videoSRTP} ` +
        `srtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${videoPort}&pkt_size=${mtu}`;
  }

  // called when iOS device asks stream to start/stop/reconfigure
  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    const sessionId = request.sessionID;

    switch (request.type) {
      case StreamRequestTypes.START:
        const sessionInfo = this.pendingSessions[sessionId];
        const video: VideoInfo = request.video;

        this.device.getStreamInfo()
            .then(streamInfo => {

              const videoffmpegCommand = this.getVideoCommand(video, sessionInfo, streamInfo);

              if (this.ffmpegDebugOutput) {
                console.log("FFMPEG command: ffmpeg " + videoffmpegCommand);
              }

              const ffmpegVideo = spawn('ffmpeg', videoffmpegCommand.split(' '), {env: process.env});

              let started = false;
              ffmpegVideo.stderr.on('data', data => {
                if (!started) {
                  started = true;
                  console.log("FFMPEG: received first frame");

                  callback(); // do not forget to execute callback once set up
                }

                if (this.ffmpegDebugOutput) {
                  console.log("VIDEO: " + String(data));
                }
              });
              ffmpegVideo.on('error', error => {
                console.log("[Video] Failed to start video stream: " + error.message);
                callback(new Error("ffmpeg process creation failed!"));
              });
              ffmpegVideo.on('exit', (code, signal) => {
                const message = "[Video] ffmpeg exited with code: " + code + " and signal: " + signal;

                if (code == null || code === 255) {
                  console.log(message + " (Video stream stopped!)");
                } else {
                  console.log(message + " (error)");

                  if (!started) {
                    callback(new Error(message));
                  } else {
                    this.controller!.forceStopStreamingSession(sessionId);
                  }
                }
              });

              this.ongoingSessions[sessionId] = { ffmpeg: ffmpegVideo, streamInfo: streamInfo};
              delete this.pendingSessions[sessionId];
            });
        break;
      case StreamRequestTypes.RECONFIGURE:
        // not supported by this example
        console.log("Received (unsupported) request to reconfigure to: " + JSON.stringify(request.video));
        callback();
        break;
      case StreamRequestTypes.STOP:
        const activeStream = this.ongoingSessions[sessionId];


        try {
          if (activeStream) {
            activeStream.ffmpeg.kill('SIGKILL');
            this.device.stopStream(activeStream.streamInfo.extensionToken);
          }
        } catch (e) {
          console.log("Error occurred terminating the video process!");
          console.log(e);
        }

        delete this.ongoingSessions[sessionId];

        console.log("Stopped streaming session!");
        callback();
        break;
    }
  }

}
