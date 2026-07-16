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
exports.getStreamer = exports.WebRtcNestStreamer = exports.RtspNestStreamer = exports.NestStreamer = void 0;
const dgram_1 = require("dgram");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const werift_1 = require("werift");
const Traits = __importStar(require("./sdm/Traits"));
const pick_port_1 = __importDefault(require("pick-port"));
const H264_1 = require("./H264");
class NestStreamer {
    constructor(log, camera, config) {
        this.log = log;
        this.camera = camera;
        this.config = config;
    }
    /**
     * Adjust the sender's target bitrate mid-stream, if the transport supports
     * it. HomeKit sends RECONFIGURE requests when the viewer's bandwidth
     * changes (e.g. watching over cellular); default is a no-op.
     */
    setMaxBitrate(bitrate) { }
}
exports.NestStreamer = NestStreamer;
class RtspNestStreamer extends NestStreamer {
    async initialize() {
        var _a, _b;
        const streamInfo = await this.camera.generateStream();
        this.token = streamInfo.streamExtensionToken;
        return {
            args: `-analyzeduration ${(_a = this.config.analyzeDuration) !== null && _a !== void 0 ? _a : 15000000} -probesize ${(_b = this.config.probeSize) !== null && _b !== void 0 ? _b : 100000000} -i ` + streamInfo.streamUrls.rtspUrl
        };
    }
    async teardown() {
        await this.camera.stopStream(this.token);
    }
}
exports.RtspNestStreamer = RtspNestStreamer;
class WebRtcNestStreamer extends NestStreamer {
    constructor() {
        super(...arguments);
        // Start high so the first IDR is not throttled by the sender's conservative
        // initial estimate; RECONFIGURE requests adjust it afterwards.
        this.rembBitrate = 4000000;
    }
    async initialize() {
        var _a, _b, _c;
        // Diagnostics: log a timeline of WebRTC startup milestones relative to this
        // point, so we can see where the time-to-first-frame actually goes
        // (connection setup vs. first RTP vs. first keyframe). Debug level only.
        const t0 = Date.now();
        const name = this.camera.getDisplayName();
        const mark = (label) => this.log.debug(`[startup +${Date.now() - t0}ms] ${label}`, name);
        const captureDir = process.env.NEST_RTP_CAPTURE_DIR;
        if (captureDir) {
            const file = path.join(captureDir, `nest-rtp-${name.replace(/[^a-zA-Z0-9]+/g, '_')}-${Date.now()}.rtpdump`);
            try {
                this.captureStream = fs.createWriteStream(file);
                this.log.info(`Capturing video RTP sent to FFmpeg to ${file}`, name);
            }
            catch (e) {
                this.log.warn(`Could not open RTP capture file ${file}.`, (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e);
            }
        }
        // Write one forwarded packet to the capture file as [2-byte BE length][bytes].
        const captureVideo = (buf) => {
            if (!this.captureStream)
                return;
            const len = Buffer.alloc(2);
            len.writeUInt16BE(buf.length, 0);
            this.captureStream.write(len);
            this.captureStream.write(Buffer.from(buf));
        };
        this.udp = (0, dgram_1.createSocket)("udp4");
        this.pc = new werift_1.RTCPeerConnection({
            bundlePolicy: "max-bundle",
            codecs: {
                audio: [
                    new werift_1.RTCRtpCodecParameters({
                        mimeType: "audio/opus",
                        clockRate: 48000,
                        channels: 2,
                    })
                ],
                video: [
                    new werift_1.RTCRtpCodecParameters({
                        mimeType: "video/H264",
                        clockRate: 90000,
                        rtcpFeedback: [
                            { type: "transport-cc" },
                            { type: "ccm", parameter: "fir" },
                            { type: "nack" },
                            { type: "nack", parameter: "pli" },
                            { type: "goog-remb" },
                        ],
                        parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'
                    })
                ],
            }
        });
        this.pc.iceConnectionStateChange.subscribe((state) => mark(`iceConnectionState: ${state}`));
        this.pc.connectionStateChange.subscribe((state) => mark(`connectionState: ${state}`));
        const options = {
            type: 'udp',
            ip: '0.0.0.0',
            reserveTimeout: 15
        };
        const audioPort = await (0, pick_port_1.default)(options);
        const audioTransceiver = this.pc.addTransceiver("audio", { direction: "recvonly" });
        audioTransceiver.onTrack.subscribe((track) => {
            audioTransceiver.sender.replaceTrack(track);
            track.onReceiveRtp.subscribe((rtp) => {
                this.udp.send(rtp.serialize(), audioPort, "127.0.0.1");
            });
        });
        let sawFirstVideoRtp = false;
        let sawFirstKeyframe = false;
        // Diagnostics for the keyframe→FFmpeg-output gap: the IDR spans many RTP
        // packets (its last one carries the marker bit), and FFmpeg cannot finish
        // probing until it has also seen the *next* frame's timestamp. These track
        // when the first keyframe finishes arriving and when the following frames
        // start, so the timeline shows whether the gap is network pacing or FFmpeg.
        let keyframeTimestamp;
        let keyframePacketCount = 0;
        let keyframeComplete = false;
        let framesAfterKeyframe = 0;
        let lastVideoTimestamp;
        const videoPort = await (0, pick_port_1.default)(options);
        const videoTransceiver = this.pc.addTransceiver("video", { direction: "recvonly" });
        videoTransceiver.onTrack.subscribe((track) => {
            mark('video track received');
            videoTransceiver.sender.replaceTrack(track);
            // The sender paces its output at its estimated available bandwidth, and
            // the initial estimate is conservative: the first IDR (~50-90 RTP packets)
            // was measured trickling in over 1.3-2.3s at ~375kbps, dominating startup.
            // REMB (negotiated in the answer SDP) is the receiver's way to raise that
            // estimate, so advertise generous bandwidth immediately and keep repeating
            // it alongside the keyframe requests. Per RFC draft, the REMB media-source
            // SSRC field is 0 and the target SSRCs ride in the feedback list.
            // setMaxBitrate() adjusts the advertised value mid-stream when HomeKit
            // reconfigures (the very first send can race DTLS setup and fail; the
            // repeat alongside the next keyframe request delivers it).
            let firstRembSent = false;
            const sendRemb = () => {
                var _a;
                let exp = 0, mantissa = this.rembBitrate;
                while (mantissa > 0x3ffff) {
                    mantissa = Math.floor(mantissa / 2);
                    exp++;
                }
                try {
                    const remb = new werift_1.RtcpPayloadSpecificFeedback({
                        feedback: new werift_1.ReceiverEstimatedMaxBitrate({
                            senderSsrc: videoTransceiver.receiver.rtcpSsrc,
                            mediaSsrc: 0,
                            ssrcNum: 1,
                            brExp: exp,
                            brMantissa: mantissa,
                            ssrcFeedbacks: [track.ssrc]
                        })
                    });
                    videoTransceiver.receiver.dtlsTransport.sendRtcp([remb]).then(() => {
                        if (!firstRembSent) {
                            firstRembSent = true;
                            mark(`sent first REMB (${this.rembBitrate / 1000000}Mbps)`);
                        }
                    }).catch((e) => { var _a; return this.log.debug('REMB send failed.', (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e); });
                }
                catch (e) {
                    this.log.debug('REMB build failed.', (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e);
                }
            };
            this.sendRemb = sendRemb;
            sendRemb();
            track.onReceiveRtp.subscribe((rtp) => {
                if (!sawFirstVideoRtp) {
                    sawFirstVideoRtp = true;
                    mark('first video RTP packet');
                }
                const isKeyframe = (0, H264_1.containsKeyframe)(rtp.payload);
                if (isKeyframe && !sawFirstKeyframe) {
                    sawFirstKeyframe = true;
                    keyframeTimestamp = rtp.header.timestamp;
                    mark('first video keyframe (IDR)');
                }
                if (sawFirstKeyframe && !keyframeComplete && rtp.header.timestamp === keyframeTimestamp) {
                    keyframePacketCount++;
                    if (rtp.header.marker) {
                        keyframeComplete = true;
                        mark(`first keyframe fully received (${keyframePacketCount} packets)`);
                    }
                }
                if (sawFirstKeyframe && rtp.header.timestamp !== keyframeTimestamp
                    && rtp.header.timestamp !== lastVideoTimestamp && framesAfterKeyframe < 3) {
                    framesAfterKeyframe++;
                    mark(`video frame ${framesAfterKeyframe} after keyframe started`);
                }
                lastVideoTimestamp = rtp.header.timestamp;
                const out = rtp.serialize();
                captureVideo(out);
                this.udp.send(out, videoPort, "127.0.0.1");
            });
            track.onReceiveRtp.once(() => {
                const receiver = videoTransceiver.receiver;
                let firSeq = 0;
                // Request a keyframe immediately, via both PLI and FIR. PLI ("picture loss")
                // asks for a recovery picture, which these cameras answer with an IDR but
                // *without* SPS/PPS — leaving FFmpeg to wait many seconds for the camera's
                // next periodic parameter sets. FIR ("full intra request", RFC 5104) asks
                // for a full intra frame, which these cameras answer with the parameter
                // sets attached (verified: every FIR-elicited keyframe carries SPS/PPS in
                // the same access unit), so FFmpeg has the dimensions at the first
                // keyframe. FIR needs a per-SSRC sequence number that increments each
                // request, or the camera ignores repeats.
                const requestKeyframe = () => {
                    var _a;
                    sendRemb();
                    receiver.sendRtcpPLI(track.ssrc).catch((e) => { var _a; return this.log.debug('PLI send failed.', (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e); });
                    try {
                        const fir = new werift_1.RtcpPayloadSpecificFeedback({
                            feedback: (0, H264_1.buildFirFeedback)(receiver.rtcpSsrc, track.ssrc, firSeq++)
                        });
                        receiver.dtlsTransport.sendRtcp([fir]).catch((e) => { var _a; return this.log.debug('FIR send failed.', (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e); });
                    }
                    catch (e) {
                        this.log.debug('FIR build failed.', (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e);
                    }
                };
                requestKeyframe();
                this.keyframeRequestInterval = setInterval(requestKeyframe, 2000);
            });
        });
        this.pc.createDataChannel('dataSendChannel', { id: 1 });
        let offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        mark('sending offer to Nest (GenerateWebRtcStream)');
        const streamInfo = await this.camera.generateStream(offer.sdp);
        mark('received answer from Nest');
        this.token = streamInfo.mediaSessionId;
        await this.pc.setRemoteDescription({
            type: 'answer',
            sdp: streamInfo.answerSdp
        });
        mark('remote description set; returning to start FFmpeg');
        // An RTP capture of what FFmpeg actually receives proved the real cause of slow
        // startup: FFmpeg already has the video dimensions at the first keyframe (the
        // camera sends its SPS/PPS in-band with it — FIR makes sure of it), so it is NOT
        // waiting for parameter sets. It was burning the analyzeduration window
        // estimating the frame rate of a slow ~7.5fps stream. Lowering analyzeduration
        // attacked that but broke cameras whose first keyframe arrives after the cap,
        // because it also limits how long find_stream_info will WAIT for codec
        // parameters. -fpsprobesize 0 targets only the fps sampling: find_stream_info
        // returns as soon as it has codec parameters, while the full analyzeduration
        // window remains available for a late keyframe. Video is stream-copied, so fps
        // metadata is never used downstream.
        return {
            args: `-protocol_whitelist pipe,crypto,udp,rtp,fd -analyzeduration ${(_b = this.config.analyzeDuration) !== null && _b !== void 0 ? _b : 15000000} -probesize ${(_c = this.config.probeSize) !== null && _c !== void 0 ? _c : 100000000} -fpsprobesize 0 -i -`,
            stdin: `v=0
o=- 0 0 IN IP4 127.0.0.1
s=-
c=IN IP4 127.0.0.1
t=0 0
m=audio ${audioPort} UDP 96
a=rtpmap:96 opus/48000/2
a=fmtp:96 minptime=10;useinbandfec=1
a=rtcp-fb:96 transport-cc
a=sendrecv
m=video ${videoPort} UDP 97
a=rtpmap:97 H264/90000
a=rtcp-fb:97 ccm fir
a=rtcp-fb:97 nack
a=rtcp-fb:97 nack pli
a=rtcp-fb:97 goog-remb
a=fmtp:97 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=sendrecv`
        };
    }
    setMaxBitrate(bitrate) {
        var _a;
        // Floor keeps a pathological low request from starving keyframe delivery
        // outright; HomeKit's lowest tiers sit around 300kbps anyway.
        const clamped = Math.max(bitrate, 300000);
        if (clamped === this.rembBitrate)
            return;
        this.rembBitrate = clamped;
        this.log.debug(`Advertising new max bitrate via REMB: ${(clamped / 1000000).toFixed(2)}Mbps`, this.camera.getDisplayName());
        (_a = this.sendRemb) === null || _a === void 0 ? void 0 : _a.call(this);
    }
    async teardown() {
        var _a, _b;
        if (this.keyframeRequestInterval) {
            clearInterval(this.keyframeRequestInterval);
            this.keyframeRequestInterval = undefined;
        }
        if (this.captureStream) {
            this.captureStream.end();
            this.captureStream = undefined;
        }
        try {
            await this.camera.stopStream(this.token);
        }
        catch (error) {
            this.log.error('Error stopping camera stream.', error);
        }
        try {
            await ((_a = this.pc) === null || _a === void 0 ? void 0 : _a.close());
        }
        catch (error) {
            this.log.error('Error closing peer connection.', error);
        }
        try {
            await ((_b = this.udp) === null || _b === void 0 ? void 0 : _b.close());
        }
        catch (error) {
            this.log.error('Error closing UDP connection to FFMpeg.', error);
        }
    }
}
exports.WebRtcNestStreamer = WebRtcNestStreamer;
async function getStreamer(log, camera, config) {
    if ((await camera.getVideoProtocol()) === Traits.ProtocolType.WEB_RTC) {
        return new WebRtcNestStreamer(log, camera, config);
    }
    else {
        return new RtspNestStreamer(log, camera, config);
    }
}
exports.getStreamer = getStreamer;
//# sourceMappingURL=NestStreamer.js.map