"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingDelegate = void 0;
const dgram_1 = require("dgram");
const os_1 = __importDefault(require("os"));
const systeminformation_1 = require("systeminformation");
const FfMpegProcess_1 = require("./FfMpegProcess");
const NestStreamer_1 = require("./NestStreamer");
const HksvStreamer_1 = __importDefault(require("./HksvStreamer"));
const PrebufferManager_1 = require("./PrebufferManager");
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
        }
        catch (e) {
            this.log.error('Prebuffer could not be started: ' + e, this.camera.getDisplayName());
        }
        api.on("shutdown" /* SHUTDOWN */, () => {
            var _a;
            for (const session in this.ongoingSessions) {
                this.stopStream(session);
            }
            // Stop the prebuffer rings too. Their reader ffmpegs would otherwise outlive the
            // bridge until they happen to take a SIGPIPE.
            (_a = this.prebufferManager()) === null || _a === void 0 ? void 0 : _a.stopAll();
        });
        this.options = {
            cameraStreamCount: camera.getResolutions().length,
            delegate: this,
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
    handleSnapshotRequest(request, callback) {
        this.camera.getSnapshot()
            .then(result => {
            callback(undefined, result);
        });
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
        var _a, _b, _c;
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
            Promise.resolve((_c = this.recordingSessionInfo.nestStreamer) === null || _c === void 0 ? void 0 : _c.teardown()).catch(e => this.log.error('Error tearing down recording SDM stream: ' + e, this.camera.getDisplayName()));
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
         * With this flag you can control how the generator reacts to a reset to the motion trigger.
         * If set to true, the generator will send a proper endOfStream if the motion stops.
         * If set to false, the generator will run till the HomeKit Controller closes the stream.
         *
         * Note: In a real implementation you would most likely introduce a bit of a delay.
         */
        const STOP_AFTER_MOTION_STOP = false;
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
        const audioArgs = ((_b = (_a = this.controller) === null || _a === void 0 ? void 0 : _a.recordingManagement) === null || _b === void 0 ? void 0 : _b.recordingManagementService.getCharacteristic(this.platform.Characteristic.RecordingAudioActive))
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
        let nestStreamer;
        let nestStream;
        const prebufferStream = this.createPrebufferStream();
        if (prebufferStream) {
            nestStream = { args: "-f mp4 -i pipe:0", stdinStream: prebufferStream };
        }
        else {
            nestStreamer = await (0, NestStreamer_1.getStreamer)(this.log, this.camera, this.config);
            nestStream = await nestStreamer.initialize();
        }
        const hksvStreamer = new HksvStreamer_1.default(this.log, nestStream, audioArgs, videoArgs, this.platform.debugMode);
        // Tear down any prior recording session before overwriting it. A HomeKit hub
        // can start a new recording (e.g. after a brief reconnect) before the previous
        // session's close event fires. Without this, the previous HksvStreamer — and
        // its ffmpeg child process — is orphaned and never cleaned up, accumulating
        // memory over time. See #150.
        if (this.recordingSessionInfo) {
            this.recordingSessionInfo.hksvStreamer.destroy();
            Promise.resolve((_c = this.recordingSessionInfo.nestStreamer) === null || _c === void 0 ? void 0 : _c.teardown()).catch(e => this.log.error('Error tearing down prior recording SDM stream: ' + e, this.camera.getDisplayName()));
        }
        this.recordingSessionInfo = {
            streamId: streamId,
            hksvStreamer: hksvStreamer,
            nestStreamer: nestStreamer
        };
        const pending = [];
        try {
            // start() belongs INSIDE the try. Outside it, a failure to start (port bind,
            // spawn error, destroy racing the listen) threw before the finally existed, so
            // the prebuffer consumer stayed subscribed and its queue grew until the
            // 240-fragment backstop destroyed it minutes later. Inside, the finally below
            // releases it immediately on every failure path.
            await hksvStreamer.start();
            if (!hksvStreamer || hksvStreamer.destroyed) {
                throw new Error('Streaming server already closed.');
            }
            for await (const box of this.recordingSessionInfo.hksvStreamer.generator()) {
                pending.push(box.header, box.data);
                const motionDetected = (_d = this.accessory.getService(this.hap.Service.MotionSensor)) === null || _d === void 0 ? void 0 : _d.getCharacteristic(this.platform.Characteristic.MotionDetected).value;
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
        }
        catch (error) {
            this.log.error("Encountered unexpected error on generator " + error.stack);
        }
        finally {
            // Release this recording's ring subscription HERE rather than relying on the hub.
            // hap-nodejs does eventually call closeRecordingStream — on a generator throw
            // immediately, but on a clean return without isLast only via a ~12s timeout — and
            // until it does, a finished recording keeps a subscriber attached and its queue
            // filling at ~150KB/s. Destroying the source is idempotent and also ends ffmpeg's
            // stdin, so the child exits instead of waiting on input that will never come.
            try {
                prebufferStream === null || prebufferStream === void 0 ? void 0 : prebufferStream.destroy();
            }
            catch (e) { /* already gone */ }
        }
    }
    /**
     * This camera's stream name on the local RTSP restreamer, or undefined when the
     * prebuffer is not configured. Defaults to a slug of the name Google reports
     * ("Front Door" -> front_door); override with `prebufferStreamNames` when the
     * restreamer names its streams differently.
     */
    prebufferKey() {
        var _a;
        if (!this.config.prebufferRtspBase)
            return undefined;
        const sourceName = this.camera.getSourceName();
        // A configured override is used VERBATIM. It exists precisely for stream names the slug
        // rule cannot produce — Home Assistant's bundled go2rtc names streams `camera.front_door`,
        // and dots, dashes and capitals are all destroyed by the slug. Slugifying the user's own
        // value would leave no way to express those names at all, and the symptom is silent: the
        // ring 404s forever, backs off to the five-minute cap, and every recording quietly falls
        // back to a direct dial with no indication the override was ignored.
        const configured = (_a = this.config.prebufferStreamNames) === null || _a === void 0 ? void 0 : _a[sourceName];
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
    advertisedPrebufferLength() {
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
    prebufferManager() {
        if (!this.config.prebufferRtspBase)
            return undefined;
        return (0, PrebufferManager_1.getPrebufferManager)(this.log, require('ffmpeg-for-homebridge') || 'ffmpeg', this.config.prebufferRtspBase, this.config.prebufferRetainSeconds);
    }
    /**
     * A Readable carrying [pre-trigger history][live], or undefined to fall back to a
     * normal SDM dial. Never throws: a prebuffer failure must cost pre-trigger footage,
     * not the recording.
     */
    createPrebufferStream() {
        var _a;
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
            const selectedMs = ((_a = this.cameraRecordingConfiguration) === null || _a === void 0 ? void 0 : _a.prebufferLength) || 0;
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
        }
        catch (e) {
            this.log.error('Prebuffer unavailable, falling back to a direct dial: ' + e, this.camera.getDisplayName());
            return undefined;
        }
    }
    updateRecordingActive(active) {
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
            }
            else {
                this.log.info(`[prebuffer:${key}] HKSV recording disabled for this camera; stopping ring`);
                manager.release(key);
            }
        }
        catch (e) {
            this.log.error('Prebuffer updateRecordingActive failed: ' + e, this.camera.getDisplayName());
        }
    }
    updateRecordingConfiguration(configuration) {
        this.cameraRecordingConfiguration = configuration;
    }
}
exports.StreamingDelegate = StreamingDelegate;
//# sourceMappingURL=StreamingDelegate.js.map