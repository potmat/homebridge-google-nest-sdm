import {Camera} from "./sdm/Camera";
import {GenerateRtspStream, GenerateWebRtcStream} from "./sdm/Responses";
import {createSocket, Socket} from "dgram";
import * as fs from "fs";
import * as path from "path";
import {RTCPeerConnection, RTCRtpCodecParameters, RtcpPayloadSpecificFeedback, ReceiverEstimatedMaxBitrate} from "werift";
import * as Traits from "./sdm/Traits";
import {Logger} from "homebridge";
import pickPort, { pickPortOptions } from 'pick-port';
import {Config} from "./Config";
import {StreamParamCache} from "./StreamParamCache";
import {extractParameterSets, containsKeyframe, buildParameterSetRtpPacket, buildFirFeedback} from "./H264";

export interface NestStream {
    args: string,
    stdin?: string
}

export abstract class NestStreamer {
    protected token: string | undefined;
    protected camera: Camera;
    protected log: Logger;
    protected streamParamCache: StreamParamCache;
    protected config: Config;

    constructor(log: Logger, camera: Camera, streamParamCache: StreamParamCache, config: Config) {
        this.log = log;
        this.camera = camera;
        this.streamParamCache = streamParamCache;
        this.config = config;
    }

    abstract initialize(): Promise<NestStream>;
    abstract teardown(): void;
}

export class RtspNestStreamer extends NestStreamer {
    async initialize(): Promise<NestStream> {
        const streamInfo = <GenerateRtspStream> await this.camera.generateStream();
        this.token = streamInfo.streamExtensionToken;
        return {
            args: `-analyzeduration ${this.config.analyzeDuration ?? 15000000} -probesize ${this.config.probeSize ?? 100000000} -i ` + streamInfo.streamUrls.rtspUrl
        };
    }

    async teardown(): Promise<void> {
        await this.camera.stopStream(this.token!);
    }
}

export class WebRtcNestStreamer extends NestStreamer {
    private udp: Socket | undefined;
    private pc: RTCPeerConnection | undefined;
    private keyframeRequestInterval: ReturnType<typeof setInterval> | undefined;
    // Debug-only: when NEST_RTP_CAPTURE_DIR is set, the exact video RTP bytes we hand
    // FFmpeg (including any synthetic packets we splice in) are written here, each
    // length-prefixed, so the stream FFmpeg actually receives can be inspected offline.
    private captureStream: fs.WriteStream | undefined;

    async initialize(): Promise<NestStream> {

        // Diagnostics: log a timeline of WebRTC startup milestones relative to this
        // point, so we can see where the time-to-first-frame actually goes
        // (connection setup vs. first RTP vs. first keyframe). Debug level only.
        const t0 = Date.now();
        const name = this.camera.getDisplayName();
        const mark = (label: string) => this.log.debug(`[startup +${Date.now() - t0}ms] ${label}`, name);

        const captureDir = process.env.NEST_RTP_CAPTURE_DIR;
        if (captureDir) {
            const file = path.join(captureDir, `nest-rtp-${name.replace(/[^a-zA-Z0-9]+/g, '_')}-${Date.now()}.rtpdump`);
            try {
                this.captureStream = fs.createWriteStream(file);
                this.log.info(`Capturing video RTP sent to FFmpeg to ${file}`, name);
            } catch (e: any) {
                this.log.warn(`Could not open RTP capture file ${file}.`, e?.message ?? e);
            }
        }
        // Write one forwarded packet to the capture file as [2-byte BE length][bytes].
        const captureVideo = (buf: Buffer) => {
            if (!this.captureStream) return;
            const len = Buffer.alloc(2);
            len.writeUInt16BE(buf.length, 0);
            this.captureStream.write(len);
            this.captureStream.write(Buffer.from(buf));
        };

        this.udp = createSocket("udp4");

        this.pc = new RTCPeerConnection({
            bundlePolicy: "max-bundle",
            codecs: {
                audio: [
                    new RTCRtpCodecParameters({
                        mimeType: "audio/opus",
                        clockRate: 48000,
                        channels: 2,
                    })
                ],
                video: [
                    new RTCRtpCodecParameters({
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

        const options: pickPortOptions = {
          type: 'udp',
          ip: '0.0.0.0',
          reserveTimeout: 15
        };
        const audioPort = await pickPort(options);
        const audioTransceiver = this.pc.addTransceiver("audio", {direction: "recvonly"});
        audioTransceiver.onTrack.subscribe((track) => {
            audioTransceiver.sender.replaceTrack(track);
            track.onReceiveRtp.subscribe((rtp) => {
                this.udp!.send(rtp.serialize(), audioPort, "127.0.0.1");
            });
        });

        const deviceId = this.camera.getName();
        const cached = this.streamParamCache.get(deviceId);
        let capturedSps: Buffer | undefined;
        let capturedPps: Buffer | undefined;
        let sawFirstVideoRtp = false;
        let sawFirstKeyframe = false;
        let injectedParams = false;
        // Diagnostics for the keyframe→FFmpeg-output gap: the IDR spans many RTP
        // packets (its last one carries the marker bit), and FFmpeg cannot finish
        // probing until it has also seen the *next* frame's timestamp. These track
        // when the first keyframe finishes arriving and when the following frames
        // start, so the timeline shows whether the gap is network pacing or FFmpeg.
        let keyframeTimestamp: number | undefined;
        let keyframePacketCount = 0;
        let keyframeComplete = false;
        let framesAfterKeyframe = 0;
        let lastVideoTimestamp: number | undefined;
        // Original sequence number of the keyframe packet we splice our SPS/PPS in
        // front of. Once set, every packet at or after this point is renumbered +1 to
        // make room for the one synthetic packet. Serial-number arithmetic (RFC 1982)
        // leaves out-of-order stragglers from *before* the splice untouched, so they
        // can't collide with the injected packet's slot.
        let injectAtSeq: number | undefined;

        const videoPort = await pickPort(options);
        const videoTransceiver = this.pc.addTransceiver("video", {direction: "recvonly"});
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
            const REMB_BITRATE = 4_000_000;
            let rembExp = 0, rembMantissa = REMB_BITRATE;
            while (rembMantissa > 0x3ffff) { rembMantissa = Math.floor(rembMantissa / 2); rembExp++; }
            let firstRembSent = false;
            const sendRemb = () => {
                try {
                    const remb = new RtcpPayloadSpecificFeedback({
                        feedback: new ReceiverEstimatedMaxBitrate({
                            senderSsrc: videoTransceiver.receiver.rtcpSsrc,
                            mediaSsrc: 0,
                            ssrcNum: 1,
                            brExp: rembExp,
                            brMantissa: rembMantissa,
                            ssrcFeedbacks: [track.ssrc!]
                        })
                    });
                    videoTransceiver.receiver.dtlsTransport.sendRtcp([remb]).then(() => {
                        if (!firstRembSent) {
                            firstRembSent = true;
                            mark(`sent first REMB (${REMB_BITRATE / 1000000}Mbps)`);
                        }
                    }).catch((e: any) => this.log.debug('REMB send failed.', e?.message ?? e));
                } catch (e: any) {
                    this.log.debug('REMB build failed.', e?.message ?? e);
                }
            };
            sendRemb();
            track.onReceiveRtp.subscribe((rtp) => {
                if (!sawFirstVideoRtp) {
                    sawFirstVideoRtp = true;
                    mark('first video RTP packet');
                }
                const isKeyframe = containsKeyframe(rtp.payload);
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

                // Splice our cached SPS/PPS in as a proper access unit immediately before
                // the first keyframe: same timestamp and SSRC as the IDR, sequenced right
                // in front of it, with every following packet renumbered +1. This mimics
                // exactly how the camera delivers its own parameter sets (SPS→PPS→IDR in
                // one access unit) — the only form FFmpeg actually honors — so it gets the
                // dimensions at the first keyframe (~1s) instead of waiting for the camera's
                // next periodic SPS (up to ~15s).
                if (cached && !injectedParams && isKeyframe) {
                    injectedParams = true;
                    injectAtSeq = rtp.header.sequenceNumber;
                    const psPacket = buildParameterSetRtpPacket({
                        sps: Buffer.from(cached.sps, 'base64'),
                        pps: Buffer.from(cached.pps, 'base64'),
                        payloadType: rtp.header.payloadType,
                        sequenceNumber: injectAtSeq,
                        timestamp: rtp.header.timestamp,
                        ssrc: rtp.header.ssrc
                    });
                    captureVideo(psPacket);
                    this.udp!.send(psPacket, videoPort, "127.0.0.1");
                    mark('injected cached SPS/PPS in-band before keyframe');
                }

                // Learn this camera's H.264 parameter sets from the live stream so future
                // streams can be primed (reads the original payload, before any renumbering).
                if (!capturedSps || !capturedPps) {
                    const {sps, pps} = extractParameterSets(rtp.payload);
                    if (sps) capturedSps = sps;
                    if (pps) capturedPps = pps;
                    if (capturedSps && capturedPps) {
                        this.streamParamCache.set(deviceId, {
                            sps: capturedSps.toString('base64'),
                            pps: capturedPps.toString('base64')
                        });
                    }
                }

                if (injectAtSeq !== undefined && ((rtp.header.sequenceNumber - injectAtSeq) & 0xffff) < 0x8000)
                    rtp.header.sequenceNumber = (rtp.header.sequenceNumber + 1) & 0xffff;
                const out = rtp.serialize();
                captureVideo(out);
                this.udp!.send(out, videoPort, "127.0.0.1");
            });
            track.onReceiveRtp.once(() => {
                const receiver = videoTransceiver.receiver;
                let firSeq = 0;
                // Request a keyframe immediately, via both PLI and FIR. PLI ("picture loss")
                // asks for a recovery picture, which these cameras answer with an IDR but
                // *without* SPS/PPS — leaving FFmpeg to wait many seconds for the camera's
                // next periodic parameter sets. FIR ("full intra request", RFC 5104) asks
                // for a full intra frame, which encoders typically resend *with* the
                // parameter sets. The hope: get the camera's own SPS to FFmpeg up front so
                // stream detection finishes fast. FIR needs a per-SSRC sequence number that
                // increments each request, or the camera ignores repeats.
                const requestKeyframe = () => {
                    sendRemb();
                    receiver.sendRtcpPLI(track.ssrc!).catch((e: any) => this.log.debug('PLI send failed.', e?.message ?? e));
                    try {
                        const fir = new RtcpPayloadSpecificFeedback({
                            feedback: buildFirFeedback(receiver.rtcpSsrc, track.ssrc!, firSeq++)
                        });
                        receiver.dtlsTransport.sendRtcp([fir]).catch((e: any) => this.log.debug('FIR send failed.', e?.message ?? e));
                    } catch (e: any) {
                        this.log.debug('FIR build failed.', e?.message ?? e);
                    }
                };
                requestKeyframe();
                this.keyframeRequestInterval = setInterval(requestKeyframe, 2000);
            });
        });

        this.pc.createDataChannel('dataSendChannel', {id: 1});

        let offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        mark('sending offer to Nest (GenerateWebRtcStream)');
        const streamInfo = <GenerateWebRtcStream> await this.camera.generateStream(offer.sdp);
        mark('received answer from Nest');
        this.token = streamInfo.mediaSessionId;
        await this.pc.setRemoteDescription({
            type: 'answer',
            sdp: streamInfo.answerSdp
        });
        mark('remote description set; returning to start FFmpeg');

        // An RTP capture of what FFmpeg actually receives proved the real cause of slow
        // startup: FFmpeg already has the video dimensions at the first keyframe (the
        // camera sends its SPS/PPS in-band with it — FIR makes sure of it — and we splice
        // our cached copy in too), so it is NOT waiting for parameter sets. It was burning
        // the analyzeduration window estimating the frame rate of a slow ~7.5fps stream.
        // Lowering analyzeduration attacked that but broke cameras whose first keyframe
        // arrives after the cap (Driveway Camera at 2s), because it also limits how long
        // find_stream_info will WAIT for codec parameters. -fpsprobesize 0 targets only
        // the fps sampling: find_stream_info returns as soon as it has codec parameters,
        // while the full 15s window remains available for a late keyframe. Video is
        // stream-copied, so fps metadata is never used downstream.
        let videoFmtp = 'a=fmtp:97 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f';
        if (cached) {
            const spsBytes = Buffer.from(cached.sps, 'base64');
            const profileLevelId = spsBytes.length >= 4 ? spsBytes.subarray(1, 4).toString('hex') : '42e01f';
            videoFmtp = `a=fmtp:97 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${profileLevelId};sprop-parameter-sets=${cached.sps},${cached.pps}`;
            this.log.debug(`Priming FFmpeg with cached H.264 parameter sets (profile-level-id=${profileLevelId}).`, this.camera.getDisplayName());
        }

        return {
            args: `-protocol_whitelist pipe,crypto,udp,rtp,fd -analyzeduration ${this.config.analyzeDuration ?? 15000000} -probesize ${this.config.probeSize ?? 100000000} -fpsprobesize 0 -i -`,
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
${videoFmtp}
a=sendrecv`
        }
    }

    async teardown(): Promise<void> {
        if (this.keyframeRequestInterval) {
            clearInterval(this.keyframeRequestInterval);
            this.keyframeRequestInterval = undefined;
        }

        if (this.captureStream) {
            this.captureStream.end();
            this.captureStream = undefined;
        }

        try {
            await this.camera.stopStream(this.token!);
        } catch (error: any) {
            this.log.error('Error stopping camera stream.', error);
        }

        try {
            await this.pc?.close();
        } catch (error: any) {
            this.log.error('Error closing peer connection.', error);
        }

        try {
            await this.udp?.close();
        } catch (error: any) {
            this.log.error('Error closing UDP connection to FFMpeg.', error);
        }
    }
}

export async function getStreamer(log: Logger, camera: Camera, streamParamCache: StreamParamCache, config: Config): Promise<NestStreamer> {
    if ((await camera.getVideoProtocol()) === Traits.ProtocolType.WEB_RTC) {
        return new WebRtcNestStreamer(log, camera, streamParamCache, config);
    } else {
        return new RtspNestStreamer(log, camera, streamParamCache, config);
    }
}