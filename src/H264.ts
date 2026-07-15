/**
 * Minimal H.264 RTP payload parsing, just enough to pull the SPS (NAL type 7)
 * and PPS (NAL type 8) parameter sets out of an incoming WebRTC video stream.
 *
 * These parameter sets are stable for a given camera and carry the video
 * dimensions FFmpeg needs before it can write the output header. By caching
 * them we can hand them to FFmpeg up front (via sprop-parameter-sets) instead
 * of waiting for it to probe them out of the live stream.
 *
 * See RFC 6184 for the H.264 RTP packetization rules referenced below.
 */

export interface ParameterSets {
    sps?: Buffer;
    pps?: Buffer;
}

const NAL_TYPE_IDR = 5;
const NAL_TYPE_SPS = 7;
const NAL_TYPE_PPS = 8;
const NAL_TYPE_STAP_A = 24;
const NAL_TYPE_FU_A = 28;

/**
 * Extract any SPS/PPS NAL units contained in a single H.264 RTP payload.
 *
 * SPS/PPS are tiny and are sent either as single NAL units or aggregated in a
 * STAP-A packet, so those are the only two packetization modes handled here.
 * Fragmented (FU-A) packets never carry parameter sets and are ignored.
 *
 * The returned buffers are the raw NAL units (including the 1-byte NAL header,
 * without any start code or length prefix) — exactly the bytes that go into an
 * SDP sprop-parameter-sets attribute once base64 encoded.
 */
export function extractParameterSets(payload: Buffer): ParameterSets {
    const result: ParameterSets = {};

    if (!payload || payload.length < 1)
        return result;

    const nalType = payload[0] & 0x1f;

    if (nalType === NAL_TYPE_SPS) {
        result.sps = Buffer.from(payload);
    } else if (nalType === NAL_TYPE_PPS) {
        result.pps = Buffer.from(payload);
    } else if (nalType === NAL_TYPE_STAP_A) {
        // STAP-A: [STAP-A header (1 byte)] then repeated [size (2 bytes BE)][NAL unit].
        let offset = 1;
        while (offset + 2 <= payload.length) {
            const size = payload.readUInt16BE(offset);
            offset += 2;
            if (size === 0 || offset + size > payload.length)
                break;
            const nalu = payload.subarray(offset, offset + size);
            const type = nalu[0] & 0x1f;
            if (type === NAL_TYPE_SPS)
                result.sps = Buffer.from(nalu);
            else if (type === NAL_TYPE_PPS)
                result.pps = Buffer.from(nalu);
            offset += size;
        }
    }

    return result;
}

/**
 * Build a single RTP packet that carries the given SPS and PPS as a STAP-A
 * aggregation. Injecting this as the first packet FFmpeg sees on the video
 * stream gives it the parameter sets (and therefore the dimensions) in-band
 * immediately, instead of waiting for the camera to send them — which some
 * cameras only do seconds in. FFmpeg ignores the SDP sprop-parameter-sets for
 * these streams but does read in-band parameter sets, so this is the reliable
 * way to prime it.
 *
 * The caller passes the payload type / SSRC of the real stream and a sequence
 * number that orders this packet just before the first real packet, so FFmpeg
 * treats it as part of the same stream.
 */
export function buildParameterSetRtpPacket(opts: {
    sps: Buffer;
    pps: Buffer;
    payloadType: number;
    sequenceNumber: number;
    timestamp: number;
    ssrc: number;
}): Buffer {
    // STAP-A: header byte (F=0, NRI=3, type=24) then repeated [size (2B BE)][NAL].
    const stapHeader = Buffer.from([0x78]);
    const spsSize = Buffer.alloc(2); spsSize.writeUInt16BE(opts.sps.length, 0);
    const ppsSize = Buffer.alloc(2); ppsSize.writeUInt16BE(opts.pps.length, 0);
    const payload = Buffer.concat([stapHeader, spsSize, opts.sps, ppsSize, opts.pps]);

    const header = Buffer.alloc(12);
    header[0] = 0x80;                              // V=2, P=0, X=0, CC=0
    header[1] = opts.payloadType & 0x7f;           // M=0, payload type
    header.writeUInt16BE(opts.sequenceNumber & 0xffff, 2);
    header.writeUInt32BE(opts.timestamp >>> 0, 4);
    header.writeUInt32BE(opts.ssrc >>> 0, 8);
    return Buffer.concat([header, payload]);
}

/**
 * Build the feedback body for an RTCP Full Intra Request (RFC 5104, PSFB FMT=4),
 * to be wrapped in werift's `RtcpPayloadSpecificFeedback`. Built here, from the
 * wire format, rather than importing werift's internal `FullIntraRequest` class
 * (which lives under werift/lib/rtp/src/... and is not part of werift's public
 * API, so it breaks on internal reorganizations).
 *
 * `RtcpPayloadSpecificFeedback` only needs three things from its feedback: the
 * FMT `count` (4 for FIR), the `length` in 32-bit words minus one, and a
 * `serialize()` that returns the FCI bytes. The layout is:
 *   [sender SSRC (4)][media SSRC (4)] then per target [SSRC (4)][seq (1)][pad (3)].
 * FIR requires a per-target command sequence number that increments each request,
 * or the encoder treats repeats as duplicates and ignores them.
 *
 * Returns `any` because werift types `feedback` as a union of its own internal
 * classes; this duck-typed object satisfies the same shape at runtime.
 */
export function buildFirFeedback(senderSsrc: number, mediaSsrc: number, sequenceNumber: number): any {
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(senderSsrc >>> 0, 0);
    buf.writeUInt32BE(mediaSsrc >>> 0, 4);
    buf.writeUInt32BE(mediaSsrc >>> 0, 8);
    buf[12] = sequenceNumber & 0xff;
    return {
        count: 4,
        length: buf.length / 4 - 1,
        serialize: () => buf
    };
}

/**
 * Whether an H.264 RTP payload carries (the start of) an IDR keyframe — the
 * first decodable picture FFmpeg can actually emit. Used only for diagnostics
 * timing of how long after stream start the first keyframe arrives.
 */
export function containsKeyframe(payload: Buffer): boolean {
    if (!payload || payload.length < 1)
        return false;

    const nalType = payload[0] & 0x1f;

    if (nalType === NAL_TYPE_IDR)
        return true;

    if (nalType === NAL_TYPE_FU_A && payload.length >= 2) {
        // FU-A: payload[1] is the FU header; its start bit marks the first fragment
        // and its low 5 bits carry the real NAL type.
        const start = (payload[1] & 0x80) !== 0;
        return start && (payload[1] & 0x1f) === NAL_TYPE_IDR;
    }

    if (nalType === NAL_TYPE_STAP_A) {
        let offset = 1;
        while (offset + 2 <= payload.length) {
            const size = payload.readUInt16BE(offset);
            offset += 2;
            if (size === 0 || offset + size > payload.length)
                break;
            if ((payload[offset] & 0x1f) === NAL_TYPE_IDR)
                return true;
            offset += size;
        }
    }

    return false;
}
