"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingDelegate = void 0;
const dgram_1 = require("dgram");
const get_port_1 = __importDefault(require("get-port"));
const os_1 = __importDefault(require("os"));
const systeminformation_1 = require("systeminformation");
const FfMpeg_1 = require("./FfMpeg");
class StreamingDelegate {
    constructor(log, api, config, camera) {
        // keep track of sessions
        this.pendingSessions = {};
        this.ongoingSessions = {};
        this.debug = true;
        this.log = log;
        this.hap = api.hap;
        this.config = config;
        this.camera = camera;
        this.videoProcessor = 'ffmpeg';
        api.on("shutdown" /* SHUTDOWN */, () => {
            for (const session in this.ongoingSessions) {
                this.stopStream(session);
            }
        });
        this.options = {
            cameraStreamCount: camera.getResolutions().length,
            delegate: this,
            streamingOptions: {
                supportedCryptoSuites: [0 /* AES_CM_128_HMAC_SHA1_80 */],
                video: {
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
                        [1600, 1200, 30]
                    ],
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
    async prepareStream(request, callback) {
        const videoReturnPort = await (0, get_port_1.default)();
        const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
        const audioReturnPort = await (0, get_port_1.default)();
        const audioSSRC = this.hap.CameraController.generateSynchronisationSource();
        const ipv6 = request.addressVersion === 'ipv6';
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
        this.log.debug(`Video stream requested: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps`, this.camera.getDisplayName());
        const streamInfo = await this.camera.getStreamInfo();
        if (!streamInfo)
            throw new Error('Unable to start stream! Stream info was not received');
        let ffmpegArgs = '-i ' + streamInfo.streamUrls.rtspUrl;
        ffmpegArgs += // Video
            ' -an -sn -dn' +
                ' -codec:v libx264 -preset ultrafast -tune zerolatency' +
                ' -pix_fmt yuv420p' +
                ' -color_range mpeg' +
                ' -bf 0' +
                ` -r ${request.video.fps}` +
                ` -b:v ${bitrate}k` +
                ` -bufsize ${bitrate}k` +
                ` -maxrate ${2 * bitrate}k` +
                ' -filter:v ' + resolution.videoFilter +
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
        const activeSession = { streamInfo: streamInfo };
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
        activeSession.mainProcess = new FfMpeg_1.FfmpegProcess(this.camera.getDisplayName(), request.sessionID, this.videoProcessor, ffmpegArgs, this.log, this.debug, this, callback);
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
        }
        try {
            await this.camera.stopStream(session.streamInfo.streamExtensionToken);
        }
        catch (err) {
            this.log.error('Error terminating SDM stream: ' + err, this.camera.getDisplayName());
        }
        delete this.ongoingSessions[sessionId];
        this.log.debug('Stopped video stream.', this.camera.getDisplayName());
    }
}
exports.StreamingDelegate = StreamingDelegate;
//# sourceMappingURL=StreamingDelegate.js.map