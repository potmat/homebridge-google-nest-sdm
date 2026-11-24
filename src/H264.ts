/**
 * Minimal H.264 RTP payload inspection (RFC 6184) plus RTCP FIR construction.
 * Used to detect keyframes for startup timeline diagnostics, and to build the
 * Full Intra Request that makes these cameras send a keyframe with its
 * SPS/PPS attached — so FFmpeg has the stream dimensions at the first
 * keyframe instead of waiting for the camera's periodic parameter sets.
 */

const NAL_TYPE_IDR = 5;
const NAL_TYPE_STAP_A = 24;
const NAL_TYPE_FU_A = 28;

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
