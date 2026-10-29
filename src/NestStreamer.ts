import {Camera} from "./sdm/Camera";
import {GenerateRtspStream, GenerateWebRtcStream} from "./sdm/Responses";
import {createSocket, Socket} from "dgram";
import * as fs from "fs";
import * as path from "path";
import {
    MediaStreamTrack,
    RTCPeerConnection,
    RTCRtpCodecParameters,
    RTCRtpTransceiver,
    RtcpPayloadSpecificFeedback,
    ReceiverEstimatedMaxBitrate
} from "werift";
import * as Traits from "./sdm/Traits";
import {Logger} from "homebridge";
import pickPort, { pickPortOptions } from 'pick-port';
import {Config} from "./Config";
import {containsKeyframe, buildFirFeedback} from "./H264";

export interface NestStream {
    args: string,
    stdin?: string
}

export abstract class NestStreamer {
    protected token: string | undefined;
    protected camera: Camera;
    protected log: Logger;
    protected config: Config;

    constructor(log: Logger, camera: Camera, config: Config) {
        this.log = log;
        this.camera = camera;
        this.config = config;
    }

    abstract initialize(): Promise<NestStream>;
    abstract teardown(): void;
}

export class RtspNestStreamer extends NestStreamer {
    async initialize(): Promise<NestStream> {
        const streamInfo = <GenerateRtspStream> await this.camera.generateStream();
        if (!streamInfo) {
            throw new Error(`Unable to start stream for ${this.camera.getDisplayName()}: no response from the Nest API (this is usually rate limiting — see the error above).`);
        }
        this.token = streamInfo.streamExtensionToken;
        return {
            args: `-analyzeduration ${this.config.analyzeDuration ?? 15000000} -probesize ${this.config.probeSize ?? 100000000} -i ` + streamInfo.streamUrls.rtspUrl
        };
    }

    async teardown(): Promise<void> {
        // initialize() can throw before this.token is set (e.g. the Nest API rate-limits the
        // generateStream call, #221). No stream was opened in that case, so there is nothing to stop —
        // and stopStream(undefined) would fire a redundant, guaranteed-to-fail SDM request.
        if (!this.token) return;
        await this.camera.stopStream(this.token);
    }
}

export class WebRtcNestStreamer extends NestStreamer {
    private static readonly REMB_BITRATE = 4_000_000;
    private udp: Socket | undefined;
    private pc: RTCPeerConnection | undefined;
    private keyframeRequestInterval: ReturnType<typeof setInterval> | undefined;
    private startTime = 0;
    private displayName = '';
    private videoTransceiver: RTCRtpTransceiver | undefined;
    private videoTrack: MediaStreamTrack | undefined;
    private firstRembSent = false;
    private firSeq = 0;
    // Debug-only: when NEST_RTP_CAPTURE_DIR is set, the exact video RTP bytes we hand
    // FFmpeg (including any synthetic packets we splice in) are written here, each
    // length-prefixed, so the stream FFmpeg actually receives can be inspected offline.
    private captureStream: fs.WriteStream | undefined;

    private mark(label: string) {
        this.log.debug(`[startup +${Date.now() - this.startTime}ms] ${label}`, this.displayName);
    }

    // Write one forwarded packet to the capture file as [2-byte BE length][bytes].
    private captureVideo(buf: Buffer) {
        if (!this.captureStream) return;
        const len = Buffer.alloc(2);
        len.writeUInt16BE(buf.length, 0);
        this.captureStream.write(len);
        this.captureStream.write(Buffer.from(buf));
    }

    // The sender paces its output at its estimated available bandwidth, and
    // the initial estimate is conservative: the first IDR (~50-90 RTP packets)
    // was measured trickling in over 1.3-2.3s at ~375kbps, dominating startup.
    // REMB (negotiated in the answer SDP) is the receiver's way to raise that
    // estimate, so advertise generous bandwidth immediately and keep repeating
    // it alongside the keyframe requests. Per RFC draft, the REMB media-source
    // SSRC field is 0 and the target SSRCs ride in the feedback list.
    private sendRemb() {
        let rembExp = 0, rembMantissa = WebRtcNestStreamer.REMB_BITRATE;
        while (rembMantissa > 0x3ffff) { rembMantissa = Math.floor(rembMantissa / 2); rembExp++; }
        try {
            const remb = new RtcpPayloadSpecificFeedback({
                feedback: new ReceiverEstimatedMaxBitrate({
                    senderSsrc: this.videoTransceiver!.receiver.rtcpSsrc,
                    mediaSsrc: 0,
                    ssrcNum: 1,
                    brExp: rembExp,
                    brMantissa: rembMantissa,
                    ssrcFeedbacks: [this.videoTrack!.ssrc!]
                })
            });
            this.videoTransceiver!.receiver.dtlsTransport.sendRtcp([remb]).then(() => {
                if (!this.firstRembSent) {
                    this.firstRembSent = true;
                    this.mark(`sent first REMB (${WebRtcNestStreamer.REMB_BITRATE / 1000000}Mbps)`);
                }
            }).catch((e: any) => this.log.debug('REMB send failed.', e?.message ?? e));
        } catch (e: any) {
            this.log.debug('REMB build failed.', e?.message ?? e);
        }
    }

    // Request a keyframe immediately, via both PLI and FIR. PLI ("picture loss")
    // asks for a recovery picture, which these cameras answer with an IDR but
    // *without* SPS/PPS — leaving FFmpeg to wait many seconds for the camera's
    // next periodic parameter sets. FIR ("full intra request", RFC 5104) asks
    // for a full intra frame, which these cameras answer with the parameter
    // sets attached (verified: every FIR-elicited keyframe carries SPS/PPS in
    // the same access unit), so FFmpeg has the dimensions at the first
    // keyframe. FIR needs a per-SSRC sequence number that increments each
    // request, or the camera ignores repeats.
    private requestKeyframe() {
        this.sendRemb();
        const receiver = this.videoTransceiver!.receiver;
        const track = this.videoTrack!;
        receiver.sendRtcpPLI(track.ssrc!).catch((e: any) => this.log.debug('PLI send failed.', e?.message ?? e));
        try {
            const fir = new RtcpPayloadSpecificFeedback({
                feedback: buildFirFeedback(receiver.rtcpSsrc, track.ssrc!, this.firSeq++)
            });
            receiver.dtlsTransport.sendRtcp([fir]).catch((e: any) => this.log.debug('FIR send failed.', e?.message ?? e));
        } catch (e: any) {
            this.log.debug('FIR build failed.', e?.message ?? e);
        }
    }

    async initialize(): Promise<NestStream> {

        // Diagnostics: log a timeline of WebRTC startup milestones relative to this
        // point, so we can see where the time-to-first-frame actually goes
        // (connection setup vs. first RTP vs. first keyframe). Debug level only.
        this.startTime = Date.now();
        this.displayName = this.camera.getDisplayName();

        const captureDir = process.env.NEST_RTP_CAPTURE_DIR;
        if (captureDir) {
            const file = path.join(captureDir, `nest-rtp-${this.displayName.replace(/[^a-zA-Z0-9]+/g, '_')}-${Date.now()}.rtpdump`);
            try {
                this.captureStream = fs.createWriteStream(file);
                this.log.info(`Capturing video RTP sent to FFmpeg to ${file}`, this.displayName);
            } catch (e: any) {
                this.log.warn(`Could not open RTP capture file ${file}.`, e?.message ?? e);
            }
        }

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

        this.pc.iceConnectionStateChange.subscribe((state) => this.mark(`iceConnectionState: ${state}`));
        this.pc.connectionStateChange.subscribe((state) => this.mark(`connectionState: ${state}`));

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

        let sawFirstVideoRtp = false;
        let sawFirstKeyframe = false;
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

        const videoPort = await pickPort(options);
        const videoTransceiver = this.pc.addTransceiver("video", {direction: "recvonly"});
        videoTransceiver.onTrack.subscribe((track) => {
            this.videoTransceiver = videoTransceiver;
            this.videoTrack = track;
            this.firstRembSent = false;
            this.firSeq = 0;
            this.mark('video track received');
            videoTransceiver.sender.replaceTrack(track);

            this.sendRemb();
            track.onReceiveRtp.subscribe((rtp) => {
                if (!sawFirstVideoRtp) {
                    sawFirstVideoRtp = true;
                    this.mark('first video RTP packet');
                }
                const isKeyframe = containsKeyframe(rtp.payload);
                if (isKeyframe && !sawFirstKeyframe) {
                    sawFirstKeyframe = true;
                    keyframeTimestamp = rtp.header.timestamp;
                    this.mark('first video keyframe (IDR)');
                }

                if (sawFirstKeyframe && !keyframeComplete && rtp.header.timestamp === keyframeTimestamp) {
                    keyframePacketCount++;
                    if (rtp.header.marker) {
                        keyframeComplete = true;
                        this.mark(`first keyframe fully received (${keyframePacketCount} packets)`);
                    }
                }
                if (sawFirstKeyframe && rtp.header.timestamp !== keyframeTimestamp
                    && rtp.header.timestamp !== lastVideoTimestamp && framesAfterKeyframe < 3) {
                    framesAfterKeyframe++;
                    this.mark(`video frame ${framesAfterKeyframe} after keyframe started`);
                }
                lastVideoTimestamp = rtp.header.timestamp;

                const out = rtp.serialize();
                this.captureVideo(out);
                this.udp!.send(out, videoPort, "127.0.0.1");
            });
            track.onReceiveRtp.once(() => {
                this.requestKeyframe();
                this.keyframeRequestInterval = setInterval(this.requestKeyframe.bind(this), 2000);
            });
        });

        this.pc.createDataChannel('dataSendChannel', {id: 1});

        let offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        this.mark('sending offer to Nest (GenerateWebRtcStream)');
        const streamInfo = <GenerateWebRtcStream> await this.camera.generateStream(offer.sdp);
        if (!streamInfo) {
            throw new Error(`Unable to start stream for ${this.camera.getDisplayName()}: no response from the Nest API (this is usually rate limiting — see the error above).`);
        }
        this.mark('received answer from Nest');
        this.token = streamInfo.mediaSessionId;
        await this.pc.setRemoteDescription({
            type: 'answer',
            sdp: streamInfo.answerSdp
        });
        this.mark('remote description set; returning to start FFmpeg');

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
a=fmtp:97 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
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

        // Only stop the SDM stream if one was actually opened. initialize() creates pc/udp above but
        // assigns this.token later (after the media session is set up), so a throw in between leaves the
        // token unset — stopStream(undefined) would be a redundant, guaranteed-to-fail SDM request (#221).
        // The pc/udp are still closed below regardless.
        if (this.token) {
            try {
                await this.camera.stopStream(this.token);
            } catch (error: any) {
                this.log.error('Error stopping camera stream.', error);
            }
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

export async function getStreamer(log: Logger, camera: Camera, config: Config): Promise<NestStreamer> {
    if ((await camera.getVideoProtocol()) === Traits.ProtocolType.WEB_RTC) {
        return new WebRtcNestStreamer(log, camera, config);
    } else {
        return new RtspNestStreamer(log, camera, config);
    }
}
