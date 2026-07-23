"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingDelegate = void 0;
const dgram_1 = require("dgram");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os_1 = __importDefault(require("os"));
const systeminformation_1 = require("systeminformation");
const FfMpegProcess_1 = require("./FfMpegProcess");
const NestStreamer_1 = require("./NestStreamer");
const HksvStreamer_1 = __importDefault(require("./HksvStreamer"));
const pick_port_1 = __importDefault(require("pick-port"));
class StreamingDelegate {
    constructor(log, api, platform, camera, accessory) {
        // keep track of sessions
        this.pendingSessions = {};
        this.ongoingSessions = {};
        this.handlingRecordingStreamingRequest = false;
        this.platform = platform;
        this.log = log;
        this.hap = api.hap;
        this.config = platform.platformConfig;
        this.camera = camera;
        this.accessory = accessory;
        api.on("shutdown" /* SHUTDOWN */, () => {
            for (const session in this.ongoingSessions) {
                this.stopStream(session);
            }
        });
        // Hand the accessory's existing MotionSensor (created by MotionAccessory
        // before any delegate is constructed) to the camera controller: HAP then
        // advertises EventTriggerOption.MOTION in the HKSV supported configuration,
        // links the sensor to RecordingManagement, and adds StatusActive. Without
        // this, plain cameras advertise an EMPTY trigger set and motion recordings
        // depend on Apple-hub heuristics. The service stays caller-managed.
        const motionService = accessory.getService(this.hap.Service.MotionSensor);
        this.options = {
            cameraStreamCount: camera.getResolutions().length,
            delegate: this,
            ...(motionService ? { sensors: { motion: motionService } } : {}),
            streamingOptions: {
                supportedCryptoSuites: [0 /* AES_CM_128_HMAC_SHA1_80 */],
                video: {
                    resolutions: camera.getResolutions(),
                    codec: {
                        profiles: [1 /* MAIN */],
                        levels: [0 /* LEVEL3_1 */]
                    }
                },
                audio: {
                    twoWayAudio: false,
                    codecs: [
                        {
                            type: "AAC-eld" /* AAC_ELD */,
                            samplerate: 16 /* KHZ_16 */,
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
                        type: 0 /* FRAGMENTED_MP4 */,
                        fragmentLength: 4000,
                    },
                    video: {
                        type: 0 /* H264 */,
                        parameters: {
                            profiles: [2 /* HIGH */],
                            levels: [2 /* LEVEL4_0 */],
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
                            type: 1 /* AAC_ELD */,
                            audioChannels: 1,
                            samplerate: 5 /* KHZ_48 */,
                            bitrateMode: 0 /* VARIABLE */,
                        },
                    },
                }
            }
        };
    }
    /**
     * Path of the periodically-refreshed JPEG that live and HKSV streams write
     * for this camera (see the snapshot output appended to the FFmpeg commands).
     */
    snapshotFilePath() {
        return path.join(this.platform.snapshotDir, this.accessory.UUID + '.jpg');
    }
    /**
     * FFmpeg output group that decodes the (otherwise stream-copied) video at a
     * low rate and keeps a single JPEG updated on disk, giving HomeKit tiles a
     * real "last seen" frame — SDM offers no snapshot API, so without this the
     * tiles only ever show a static placeholder logo.
     */
    snapshotOutputArgs() {
        // Unavailable directory → no snapshot output at all: a broken extra output
        // would otherwise take the entire FFmpeg command (and the stream) down.
        // -atomic_writing makes each frame a temp-file+rename, so a concurrent
        // reader or second writer (live view + HKSV recording) never sees a torn file.
        if (!this.platform.snapshotDir)
            return [];
        return [
            '-an', '-sn', '-dn',
            '-codec:v', 'mjpeg',
            '-q:v', '4',
            '-vf', 'fps=1/2,scale=640:-2',
            '-f', 'image2',
            '-update', '1',
            '-atomic_writing', '1',
            '-y', this.snapshotFilePath()
        ];
    }
    handleSnapshotRequest(request, callback) {
        this.log.debug(`Snapshot requested (reason: ${request.reason === undefined ? 'unspecified' : request.reason === 0 /* PERIODIC */ ? 'periodic' : 'event'})`, this.camera.getDisplayName());
        if (request.reason === 1 /* EVENT */) {
            const image = this.camera.getCachedEventImage();
            if (image) {
                callback(undefined, image);
                return;
            }
        }
        if (!this.platform.snapshotDir) {
            this.camera.getSnapshot()
                .then(result => callback(undefined, result))
                .catch(error => callback(error));
            return;
        }
        const snapshotFile = this.snapshotFilePath();
        fs.promises.stat(snapshotFile)
            .then(stats => {
            if (Date.now() - stats.mtimeMs > StreamingDelegate.SNAPSHOT_MAX_AGE_MS)
                throw new Error('snapshot file too old');
            return fs.promises.readFile(snapshotFile);
        })
            .then(image => {
            // Serve the file only if it is a structurally complete JPEG (SOI...EOI);
            // a partial file (killed FFmpeg, disk full) must fall back, not break the tile.
            if (image.length >= 4 && image[0] === 0xff && image[1] === 0xd8
                && image[image.length - 2] === 0xff && image[image.length - 1] === 0xd9) {
                callback(undefined, image);
            }
            else {
                throw new Error('incomplete snapshot file');
            }
        })
            .catch(() => this.camera.getSnapshot()
            .then(result => callback(undefined, result))
            .catch(error => callback(error)));
    }
    static determineResolution(request) {
        let width = request.width;
        let height = request.height;
        const filters = [];
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
    async getIpAddress(ipv6) {
        var _a;
        const interfaceName = await (0, systeminformation_1.networkInterfaceDefault)();
        const interfaces = os_1.default.networkInterfaces();
        // @ts-ignore
        const externalInfo = (_a = interfaces[interfaceName]) === null || _a === void 0 ? void 0 : _a.filter((info) => {
            return !info.internal;
        });
        const preferredFamily = ipv6 ? 'IPv6' : 'IPv4';
        const addressInfo = (externalInfo === null || externalInfo === void 0 ? void 0 : externalInfo.find((info) => {
            return info.family === preferredFamily;
        })) || (externalInfo === null || externalInfo === void 0 ? void 0 : externalInfo[0]);
        if (!addressInfo) {
            throw new Error('Unable to get network address for "' + interfaceName + '"!');
        }
        return addressInfo.address;
    }
    /**
     * Some callback methods do not log anything if they are called with an error.
     */
    logThenCallback(callback, message) {
        this.log.error(message);
        callback(new Error(message));
    }
    async prepareStream(request, callback) {
        const camaraInfo = await this.camera.getCameraLiveStream();
        if (!camaraInfo) {
            this.logThenCallback(callback, 'Unable to start stream! Camera info was not received');
            return;
        }
        const ipv6 = request.addressVersion === 'ipv6';
        const options = {
            type: 'udp',
            ip: ipv6 ? '::' : '0.0.0.0',
            reserveTimeout: 15
        };
        const videoReturnPort = await (0, pick_port_1.default)(options);
        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
        const audioReturnPort = await (0, pick_port_1.default)(options);
        const audioSSRC = this.hap.CameraController.generateSynchronisationSource();
        const currentAddress = await this.getIpAddress(ipv6);
        const sessionInfo = {
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
        const response = {
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
    async startStream(request, callback) {
        const sessionInfo = this.pendingSessions[request.sessionID];
        const resolution = StreamingDelegate.determineResolution(request.video);
        const bitrate = request.video.max_bit_rate * 4;
        const vEncoder = this.config.vEncoder || 'libx264 -preset ultrafast -tune zerolatency';
        this.log.debug(`Video stream requested: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps`, this.camera.getDisplayName());
        const nestStreamer = await (0, NestStreamer_1.getStreamer)(this.log, this.camera, this.config);
        let ffmpegArgs;
        let nestStream;
        try {
            nestStream = await nestStreamer.initialize(); // '-analyzeduration 15000000 -probesize 100000000 -i ' + streamInfo.streamUrls.rtspUrl;
            ffmpegArgs = nestStream.args;
        }
        catch (error) {
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
        // ffmpegArgs is a whitespace-split STRING (see FfmpegProcess), so a snapshot
        // path containing spaces would shatter the whole command and kill the stream.
        // Skip the snapshot output in that case — the HKSV path passes args as an
        // array and keeps working regardless.
        const snapshotArgs = this.snapshotOutputArgs();
        if (snapshotArgs.length > 0 && !/\s/.test(this.snapshotFilePath())) {
            ffmpegArgs += ' ' + snapshotArgs.join(' ');
        }
        else if (snapshotArgs.length > 0) {
            this.log.debug('Snapshot path contains whitespace; skipping snapshot output on the live stream.', this.camera.getDisplayName());
        }
        if (this.platform.debugMode) {
            ffmpegArgs += ' -loglevel level+verbose';
        }
        const activeSession = { streamer: nestStreamer };
        try {
            activeSession.socket = (0, dgram_1.createSocket)(sessionInfo.ipv6 ? 'udp6' : 'udp4');
            activeSession.socket.on('error', (err) => {
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
        }
        catch (error) {
            this.logThenCallback(callback, error);
            return;
        }
        activeSession.mainProcess = new FfMpegProcess_1.FfmpegProcess(this.camera.getDisplayName(), request.sessionID, ffmpegArgs, nestStream.stdin, this.log, this.platform.debugMode, this, callback);
        this.ongoingSessions[request.sessionID] = activeSession;
        delete this.pendingSessions[request.sessionID];
    }
    async handleStreamRequest(request, callback) {
        switch (request.type) {
            case "start" /* START */:
                this.startStream(request, callback);
                break;
            case "reconfigure" /* RECONFIGURE */:
                this.log.debug(`Received request to reconfigure: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps (Ignored)`, this.camera.getDisplayName());
                callback();
                break;
            case "stop" /* STOP */:
                await this.stopStream(request.sessionID);
                callback();
                break;
        }
    }
    async stopStream(sessionId) {
        var _a, _b, _c;
        const session = this.ongoingSessions[sessionId];
        if (session) {
            if (session.timeout) {
                clearTimeout(session.timeout);
            }
            try {
                (_a = session.socket) === null || _a === void 0 ? void 0 : _a.close();
            }
            catch (err) {
                this.log.error('Error occurred closing socket: ' + err, this.camera.getDisplayName());
            }
            try {
                (_b = session.mainProcess) === null || _b === void 0 ? void 0 : _b.stop();
            }
            catch (err) {
                this.log.error('Error occurred terminating main FFmpeg process: ' + err, this.camera.getDisplayName());
            }
            try {
                (_c = session.returnProcess) === null || _c === void 0 ? void 0 : _c.stop();
            }
            catch (err) {
                this.log.error('Error occurred terminating two-way FFmpeg process: ' + err, this.camera.getDisplayName());
            }
            try {
                await session.streamer.teardown();
            }
            catch (err) {
                this.log.error('Error terminating SDM stream: ' + err, this.camera.getDisplayName());
            }
        }
        delete this.ongoingSessions[sessionId];
        this.log.debug('Stopped video stream.', this.camera.getDisplayName());
    }
    closeRecordingStream(streamId, reason) {
        var _a, _b;
        // Only tear down if this close targets the session we're actually running. A HomeKit hub can
        // send a late close for an already-replaced (orphaned) session; without this guard that stale
        // close would destroy the *current* recording.
        if (this.recordingSessionInfo && this.recordingSessionInfo.streamId !== streamId) {
            this.log.debug(`Ignoring recording close for a stale/replaced session id ${streamId}.`, this.camera.getDisplayName());
            return;
        }
        if ((_a = this.recordingSessionInfo) === null || _a === void 0 ? void 0 : _a.hksvStreamer) {
            (_b = this.recordingSessionInfo) === null || _b === void 0 ? void 0 : _b.hksvStreamer.destroy();
            // teardown() is async; an unhandled rejection here would restart the bridge on Node >= 15.
            Promise.resolve(this.recordingSessionInfo.nestStreamer.teardown()).catch(e => this.log.error('Error tearing down recording SDM stream: ' + e, this.camera.getDisplayName()));
            this.recordingSessionInfo = undefined;
        }
        this.handlingRecordingStreamingRequest = false;
    }
    acknowledgeStream(streamId) {
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
    async *handleRecordingStreamRequest(streamId) {
        var _a, _b, _c, _d;
        this.log.debug('Recording request received.');
        if (!this.cameraRecordingConfiguration)
            throw new Error('No recording configuration for this camera.');
        /**
         * End the recording with a proper endOfStream once motion stops, instead of
         * running until the HomeKit controller closes the stream. Left to the
         * controller, sessions can run for hours (observed: a 3h50m recording on a
         * doorbell with sparse motion), keeping the camera streaming continuously
         * and leaving it briefly unable to serve live views after the session
         * finally closes. The motion sensor already decays 20s after the last
         * motion event, so recordings end with ~20-25s of post-motion tail.
         */
        const endOnMotionStop = (_a = this.config.endRecordingOnMotionStop) !== null && _a !== void 0 ? _a : true;
        this.handlingRecordingStreamingRequest = true;
        if (this.cameraRecordingConfiguration.videoCodec.type !== 0 /* H264 */)
            throw new Error('Unsupported recording codec type.');
        const profile = this.cameraRecordingConfiguration.videoCodec.parameters.profile === 2 /* HIGH */ ? "high"
            : this.cameraRecordingConfiguration.videoCodec.parameters.profile === 1 /* MAIN */ ? "main" : "baseline";
        const level = this.cameraRecordingConfiguration.videoCodec.parameters.level === 2 /* LEVEL4_0 */ ? "4.0"
            : this.cameraRecordingConfiguration.videoCodec.parameters.level === 1 /* LEVEL3_2 */ ? "3.2" : "3.1";
        const videoArgs = [
            "-an",
            "-sn",
            "-dn",
            "-codec:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-profile:v", profile,
            "-level:v", level,
            "-b:v", `${this.cameraRecordingConfiguration.videoCodec.parameters.bitRate}k`,
            "-force_key_frames", `expr:eq(t,n_forced*${this.cameraRecordingConfiguration.videoCodec.parameters.iFrameInterval / 1000})`,
            "-r", this.cameraRecordingConfiguration.videoCodec.resolution[2].toString(),
        ];
        let samplerate;
        switch (this.cameraRecordingConfiguration.audioCodec.samplerate) {
            case 0 /* KHZ_8 */:
                samplerate = "8";
                break;
            case 1 /* KHZ_16 */:
                samplerate = "16";
                break;
            case 2 /* KHZ_24 */:
                samplerate = "24";
                break;
            case 3 /* KHZ_32 */:
                samplerate = "32";
                break;
            case 4 /* KHZ_44_1 */:
                samplerate = "44.1";
                break;
            case 5 /* KHZ_48 */:
                samplerate = "48";
                break;
            default:
                throw new Error("Unsupported audio sample rate: " + this.cameraRecordingConfiguration.audioCodec.samplerate);
        }
        const audioArgs = ((_c = (_b = this.controller) === null || _b === void 0 ? void 0 : _b.recordingManagement) === null || _c === void 0 ? void 0 : _c.recordingManagementService.getCharacteristic(this.platform.Characteristic.RecordingAudioActive))
            ? [
                "-acodec", "libfdk_aac",
                ...(this.cameraRecordingConfiguration.audioCodec.type === 0 /* AAC_LC */ ?
                    ["-profile:a", "aac_low"] :
                    ["-profile:a", "aac_eld"]),
                "-ar", `${samplerate}k`,
                "-b:a", `${this.cameraRecordingConfiguration.audioCodec.bitrate}k`,
                "-ac", `${this.cameraRecordingConfiguration.audioCodec.audioChannels}`,
            ]
            : [];
        const nestStreamer = await (0, NestStreamer_1.getStreamer)(this.log, this.camera, this.config);
        const nestStream = await nestStreamer.initialize();
        const hksvStreamer = new HksvStreamer_1.default(this.log, nestStream, audioArgs, videoArgs, this.platform.debugMode, this.snapshotOutputArgs());
        // Tear down any prior recording session before overwriting it. A HomeKit hub
        // can start a new recording (e.g. after a brief reconnect) before the previous
        // session's close event fires. Without this, the previous HksvStreamer — and
        // its ffmpeg child process — is orphaned and never cleaned up, accumulating
        // memory over time. See #150.
        if (this.recordingSessionInfo) {
            this.recordingSessionInfo.hksvStreamer.destroy();
            Promise.resolve(this.recordingSessionInfo.nestStreamer.teardown()).catch(e => this.log.error('Error tearing down prior recording SDM stream: ' + e, this.camera.getDisplayName()));
        }
        this.recordingSessionInfo = {
            streamId: streamId,
            hksvStreamer: hksvStreamer,
            nestStreamer: nestStreamer
        };
        await hksvStreamer.start();
        if (!hksvStreamer || hksvStreamer.destroyed) {
            throw new Error('Streaming server already closed.');
        }
        const pending = [];
        try {
            for await (const box of this.recordingSessionInfo.hksvStreamer.generator()) {
                pending.push(box.header, box.data);
                const motionDetected = (_d = this.accessory.getService(this.hap.Service.MotionSensor)) === null || _d === void 0 ? void 0 : _d.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
                this.log.debug("mp4 box type " + box.type + " and length " + box.length);
                if (box.type === "moov" || box.type === "mdat") {
                    const fragment = Buffer.concat(pending);
                    pending.splice(0, pending.length);
                    const isLast = endOnMotionStop && !motionDetected;
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
        }
        catch (error) {
            this.log.error("Encountered unexpected error on generator " + error.stack);
        }
    }
    updateRecordingActive(active) {
        // we haven't implemented a prebuffer
        this.log.debug("Recording active set to " + active);
    }
    updateRecordingConfiguration(configuration) {
        this.cameraRecordingConfiguration = configuration;
    }
}
exports.StreamingDelegate = StreamingDelegate;
// A stream-written snapshot older than this is treated as absent: a day-old
// "last seen" frame is still useful, but an ancient one masquerades as current
// and shadows the fresher event-image path in camera.getSnapshot().
StreamingDelegate.SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
//# sourceMappingURL=StreamingDelegate.js.map