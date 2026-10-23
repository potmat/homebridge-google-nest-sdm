import {spawn, ChildProcess} from "child_process";
import {Readable} from "stream";
import {Logger} from "homebridge";

/**
 * PrebufferManager — a rolling pre-trigger buffer for HKSV recordings.
 *
 * THE PROBLEM
 * -----------
 * A recording only starts once HomeKit asks for one, which is downstream of
 * Google's Pub/Sub delivery. Measured on a live deployment (2026-07-29):
 *
 *     Google event timestamp -> Pub/Sub delivery :  2.0-2.3s (best), median 7.5s
 *     delivery -> ffmpeg connected + keyframe    : ~1.0s
 *     ------------------------------------------------------
 *     event timestamp -> first recorded frame    : ~3.3s (best case)
 *
 * and Google's own detection lag sits BEFORE its timestamp, unmeasured. Someone
 * walking to a door is routinely gone by the first frame, so HomeKit's on-device
 * People/Animals/Vehicles analysis finds no subject and SILENTLY DISCARDS the
 * clip -- with every layer reporting success and `reason=NORMAL` on close.
 *
 * Separately, HomeKit *asks* for footage before the trigger (`prebufferLength`);
 * that requirement is additive to the lateness above. To honestly serve a 4s
 * advertised prebuffer we need 4 + ~3.3 = ~7.3s of history.
 *
 * THE APPROACH
 * ------------
 * Continuously remux each camera out of a local RTSP restreamer with `-c copy`
 * -- no encoding, so the cost is a few percent of one core -- into fragmented
 * MP4, and keep the last N seconds of fragments in memory. On a trigger the
 * recorder is fed [buffered history] + [live], so it begins in the past.
 *
 * Fragmented MP4 rather than mpegts because every `moof` starts at a keyframe and
 * box headers are self-describing, so safe cut points need no codec parsing. This
 * is also exactly the format HksvStreamer already consumes. Measured here:
 * ~1.67s per fragment, init segment 1285 bytes, ~150KB/s => ~2.3MB per camera.
 *
 * WHY A LOCAL RESTREAMER AND NOT SDM DIRECTLY
 * -------------------------------------------
 * The ring has to hold a stream open continuously, which is the whole point --
 * history cannot be recovered retroactively. Pointing it at SDM would mean one
 * permanently-open WebRTC session per camera, renewed every ~5 minutes, forever.
 * A local restreamer (go2rtc, MediaMTX, or anything else that serves RTSP)
 * multiplexes that into a single upstream session, which is why this is opt-in
 * and configured by RTSP base URL rather than built on the plugin's own
 * NestStreamer. See `prebufferRtspBase` in config.
 *
 * ANCHORING
 * ---------
 * Callers request history relative to the *event timestamp*, not to "now".
 * Connection time varies with Pub/Sub latency, so anchoring to it would make the
 * recovered window vary by seconds run to run. The plugin knows the Google
 * timestamp, so it can ask for exactly what it needs.
 */

/** Fragments buffered for one camera, newest last. */
type Fragment = {
    t: number,
    data: Buffer
};

/** A snapshot of the ring: the init segment plus the fragments a caller asked for. */
export type PrebufferHistory = {
    init: Buffer,
    fragments: Buffer[],
    oldestAvailable: number
};

export type PrebufferStats = {
    fragments: number,
    seconds: number,
    haveInit: boolean,
    subscribers: number,
    totalFragments: number,
    restarts: number
};

type FragmentSubscriber = (fragment: Buffer) => void;

// Boxes that together form the init segment every consumer needs first.
const INIT_BOXES = new Set(["ftyp", "moov"]);

// `mfra` is a random-access index ffmpeg writes at end-of-file; it never appears
// mid-live-stream and would be meaningless to forward. The others are padding.
const SKIP_BOXES = new Set(["mfra", "free", "skip"]);

// Sizing, derived from a measured event (2026-07-29 12:44) rather than picked:
//
//   Google Home's own clip started  12:44:42.0
//   SDM event timestamp             12:44:48.1   <- already 6.1s stale when issued
//   our first frame                ~12:44:51.7   <- +3.6s for delivery + ffmpeg
//
// To match what Google Home actually shows, history must reach ~6-8s BEFORE the
// event timestamp, while the request itself arrives ~3.6s AFTER it -- so the ring
// must span ~11.6s. 12s would sit exactly on that edge; 15s leaves margin for the
// jitter in delivery latency without costing anything meaningful: ~150KB/s per
// camera => ~2.3MB.
//
// This does NOT rescue the long tail of Pub/Sub latency (median 7.5s across a day,
// p75 47.8s): a 15s ring cannot span a 48s-late delivery, and for those events the
// served history begins long after the subject left. Retention margin is not
// latency coverage. Such events remain lost, and no prebuffer size fixes them --
// only Google delivering sooner would.
const DEFAULT_BUFFER_SECONDS = 15;

// A fragment is ~250KB. This caps a single camera near ~50MB even if the clock
// misbehaves or fragments arrive far faster than expected.
const MAX_FRAGMENTS = 200;

// No legitimate box here approaches this: fragments run ~250KB, init ~1.3KB. A
// larger declared size means the parse has desynced, and without a cap we would
// accumulate `pending` toward the 32-bit maximum (4GB) and OOM a small host long
// before any error surfaced.
const MAX_BOX_BYTES = 16 * 1024 * 1024;

// Backstop for a consumer that stops draining (see the destroy-before-start case
// in HksvStreamer): without this the queue grows at ~150KB/s indefinitely.
const MAX_QUEUED_FRAGMENTS = 240;

// A ring whose newest fragment is older than this is not usable for pre-trigger history.
// Generous relative to the ~1.67s IDR cadence, but well inside the hub's ~16s patience.
const STALE_RING_MS = 20000;

// If a reader that HAS produced goes this long without a fragment, it has stalled silently.
// Nest drops to very low frame rates when idle, so this must be well clear of that; 60s is
// ~36x the observed cadence and still recovers long before the next likely event.
const READER_STALL_MS = 60000;

// Much tighter deadline for a reader that has written its init segment this run but has not
// produced a single fragment. Once ffmpeg has emitted ftyp+moov the RTSP session is
// established and the stream parameters are known, so the only thing left to wait for is a
// keyframe -- measured here at 3.9-4.9s to the first fragment and ~1.4-1.6s between them.
// 20s is ~4x the slowest observed first-fragment time, and is measured FROM THE INIT SEGMENT
// rather than from spawn, so a slow cold dial spends its time before the clock starts.
//
// This exists because "session up, audio flowing, video never arrives" is a real state: the
// audio traffic keeps ffmpeg's socket timeout from firing, and -movflags frag_keyframe never
// cuts a fragment without video keyframes, so ffmpeg sits alive and silent with no stderr.
// Waiting the full 60s for that leaves the ring empty three times longer than necessary.
const READER_NO_FRAGMENT_MS = 20000;

// If a consumer has been served history but no LIVE fragment arrives within this long, the
// reader has stalled since we snapshotted. Ending the stream lets ffmpeg finalize what it has,
// so HomeKit gets a short history-only clip instead of timing out and discarding everything.
// Must be comfortably under the hub's ~16s patience.
const LIVE_FLOW_DEADMAN_MS = 8000;

// A ring poisoned by an upstream timestamp re-base clamps ~50x/second, sustained, because
// every packet after the re-base is behind its predecessor (measured 2026-08-03: 1218 and
// 1398 clamps inside single failed recordings). An isolated clamp is a different animal --
// one camera here emits one every few minutes and every recording it fed still closed
// reason=0. 20-in-10s sits far above the isolated rate and is reached in well under a second
// by a real freeze, so the two cannot be confused.
const DTS_CLAMP_WINDOW_MS = 10000;
const DTS_CLAMP_THRESHOLD = 20;

// Report isolated clamps at most this often per camera, so a chatty one cannot flood.
const CLAMP_LOG_THROTTLE_MS = 60000;

class CameraBuffer {
    private readonly log: Logger;
    readonly name: string;
    private readonly url: string;
    private readonly ffmpegPath: string;
    private readonly bufferSeconds: number;

    initSegment: Buffer = Buffer.alloc(0);
    fragments: Fragment[] = [];
    readonly subscribers = new Set<FragmentSubscriber>();

    // Streams currently being served. A restarted ffmpeg emits a fresh moov and
    // restarts mfhd/tfdt at ~0, so its fragments CANNOT be appended to a
    // recording initialised from the previous timeline -- the recorder would see
    // DTS jump backwards by hours. Consumers are destroyed on restart instead;
    // the caller falls back to dialling the camera directly next time.
    readonly activeStreams = new Set<Readable>();

    private stopped = false;
    private child?: ChildProcess;
    private restarts = 0;
    private totalFragments = 0;
    private backoffMs = 1000;
    private restartTimer?: NodeJS.Timeout;
    private stallTimer?: NodeJS.Timeout;

    private pending: Buffer = Buffer.alloc(0);
    private pendingMoof?: Buffer;

    private startedAt = 0;

    // A camera that has NEVER produced an init segment almost certainly has no
    // stream at all (404) or is switched off. Retrying such a camera on the
    // normal cadence pokes the restreamer -> Nest forever for nothing, so its
    // backoff is allowed to grow much further than a camera that was working
    // and then dropped.
    private everProduced = false;

    // Timestamp of the last published fragment. A camera that worked earlier but has
    // been dark for a while (cameras are often switched off overnight) should not keep
    // poking the restreamer -> SDM once a minute all night for nothing.
    private lastProducedAt = 0;

    // Watchdog bookkeeping, deliberately separate from lastProducedAt (see the stall
    // watchdog): consecutive kills with no fragment in between mean this camera is not
    // recovering, and it should back off like any other dead camera.
    private lastStallKillAt = 0;
    private stallKills = 0;

    // Per-RUN counters, reset on every spawn. `everProduced`/`lastProducedAt` are lifetime
    // values and cannot answer "is THIS child working?", which is the question both the
    // fast-fail deadline and the backoff reset actually need.
    private fragmentsThisRun = 0;
    private sawInitThisRun = false;
    private initAtThisRun = 0;

    // Guards the two paths that can end a run ('exit', and 'error' when spawn itself
    // failed) from both scheduling a restart.
    private exitHandled = false;

    // Sliding window of muxer dts-clamp times, to tell a sustained freeze from a hiccup.
    private dtsClamps: number[] = [];
    private lastClampLogAt = 0;

    // Video geometry last reported by this run, to catch a mid-session resolution change.
    private lastGeometry?: string;

    constructor(log: Logger, name: string, url: string, ffmpegPath: string, bufferSeconds: number) {
        this.log = log;
        this.name = name;
        this.url = url;
        this.ffmpegPath = ffmpegPath;
        this.bufferSeconds = bufferSeconds;
    }

    start(): void {
        if (this.stopped) {
            return;
        }

        const args = [
            // "warning", not "error": the mp4 muxer's "Non-monotonous DTS ... changing to
            // prev+1" clamp is a WARNING, and that clamp is the only direct evidence that
            // this reader's timeline has been poisoned by an upstream re-base. At "error" it
            // is discarded, which is exactly how a 3h53m poisoning went unnoticed on
            // 2026-08-03 -- and it would also make the stderr backstop below dead code.
            "-hide_banner", "-loglevel", "warning",
            "-rtsp_transport", "tcp",
            // Die on a stalled socket instead of blocking forever. 15s is inside the ring's
            // retention, so a stall is normally recovered before history even goes stale.
            "-timeout", "15000000",
            "-i", this.url,
            "-c", "copy",
            "-f", "mp4",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof",
            "pipe:1",
        ];

        this.log.debug(`[prebuffer:${this.name}] starting reader ${this.url}`);

        let child: ChildProcess;
        try {
            child = spawn(this.ffmpegPath, args, {env: process.env, stdio: ["ignore", "pipe", "pipe"]});
        } catch (e) {
            this.log.error(`[prebuffer:${this.name}] cannot spawn ffmpeg: ${e}`);
            this.scheduleRestart();
            return;
        }

        this.child = child;
        const startedAt = Date.now();
        this.startedAt = startedAt;
        this.fragmentsThisRun = 0;
        this.sawInitThisRun = false;
        this.initAtThisRun = 0;
        this.exitHandled = false;
        // Per-run: the next child writes a fresh init segment, so the geometry it reports
        // first is the new baseline. Carrying the old value across a restart would fire the
        // detector on the very geometry the new init segment correctly describes.
        this.lastGeometry = undefined;
        this.pending = Buffer.alloc(0);
        this.pendingMoof = undefined;

        // Non-null: stdio is spawned as ["ignore", "pipe", "pipe"] just above.
        child.stdout!.on("data", (chunk: Buffer) => this.consume(chunk));

        // Stall watchdog. Covers three shapes: a reader that produced and then went silent
        // (60s from its last fragment), one whose session came up but never delivered video
        // (20s from the init segment), and one that never produced anything at all -- a hung
        // connect, or a camera that answers and then sends nothing (60s from spawn). Only a
        // reader that exits on its own is left to the backoff path.
        this.stallTimer = setInterval(() => {
            if (this.stopped) {
                return;
            }

            // A reader that has written its init segment this run but produced no fragment is
            // in the "session up, video never arrived" state and will not recover on its own.
            // Gate on sawInitThisRun rather than the ring's initSegment. They happen to agree
            // today (the exit handler wipes initSegment), but the ring's copy answers "does the
            // ring hold an init segment", not "did THIS child emit one" -- and only the second
            // question means the session is up. Keeping them separate is what stops a future
            // change to the wipe from silently cutting short a reader that is still connecting.
            const starvedThisRun = this.sawInitThisRun && this.fragmentsThisRun === 0;

            // EVERY basis here must be per-run.
            //
            // Reading lifetime `lastProducedAt` directly was a serious bug: after any stall
            // kill it is >=60s old by construction, so the next child was judged against its
            // predecessor's timestamp, the deadline was already blown on its first tick, and a
            // recovered healthy reader was killed ~5s after spawn -- typically ~1s before its
            // first fragment -- on every attempt. The camera never came back until Homebridge
            // restarted.
            //
            // Starved runs measure from the INIT segment, not from spawn: that is the moment
            // the session is established and the only outstanding thing is a keyframe, which
            // is what the 20s budget is actually for. On a cold dial (fresh Nest WebRTC:
            // OAuth + ExchangeSDP) init can be ~16s in, and measuring from spawn would leave
            // a working stream only ~4s to produce.
            const since = starvedThisRun
                ? this.initAtThisRun
                : Math.max(this.lastProducedAt, this.startedAt);

            if (!since) {
                return;
            }

            const idle = Date.now() - since;
            const limit = starvedThisRun ? READER_NO_FRAGMENT_MS : READER_STALL_MS;

            if (idle > limit) {
                this.log.warn(starvedThisRun
                    ? `[prebuffer:${this.name}] reader connected but delivered no video for ${Math.round(idle / 1000)}s; restarting it`
                    : `[prebuffer:${this.name}] reader alive but silent for ${Math.round(idle / 1000)}s; restarting it`);
                // Do NOT touch lastProducedAt: scheduleRestart() reads it to decide whether
                // this camera is in a sustained outage, and the healthy-backoff-reset reads it
                // too. Refreshing it here made a repeatedly-stalling camera look permanently
                // healthy, pinning backoff at 1s and hammering the restreamer every minute.
                this.lastStallKillAt = Date.now();
                this.stallKills++;
                this.killChild();
            }
            // 5s, not 15s: the tick is the granularity of both deadlines above, so a 15s tick
            // turned the 20s fast-fail into an effective 30s and the 60s deadline into 60-75s
            // (the observed kill messages said "60s" and "75s" for exactly this reason). The
            // extra wakeups are negligible and the timer is unref'd.
        }, 5000);
        this.stallTimer.unref();

        // Never discard ffmpeg's stderr. A reader that silently produces nothing
        // is indistinguishable from a healthy idle camera, and that ambiguity has
        // cost real debugging time on this deployment before.
        child.stderr!.on("data", (d: Buffer) => {
            const s = d.toString().trim();
            if (!s) {
                return;
            }

            // A producer restart behind the restreamer splices a NEW RTP stream -- random
            // sequence numbers AND random timestamp bases -- into this still-open RTSP
            // session. Over TCP a cseq jump cannot be loss or reordering, so it can only mean
            // the server switched sources underneath us. ffmpeg does not re-anchor, and either
            // direction is harmful. A track whose new base lands BEHIND makes our own mp4
            // muxer clamp every later dts to prev+1. A track landing AHEAD stays monotonic on
            // its own, but it is now offset from the other track, so a multi-track clip is
            // misaligned (kreucher's forward-jump test on go2rtc#2404). The BEHIND clamp is a
            // warning, so at the -loglevel error this reader used to run at it was thrown away
            // silently (hence the loglevel change above). The ring then holds real audio on a
            // FROZEN timeline, and every clip cut from it is rejected by the hub with reason=5
            // (UNEXPECTED_FAILURE).
            //
            // Measured 2026-08-03: a 04:26:43 splice poisoned one camera's ring for 4h53m.
            // It was invisible until the first doorbell press at 08:19:57, which failed, as
            // did HomeKit's retry 9s later -- a real person, missed entirely. All 12
            // recordings before the splice closed reason=0 with zero timestamp warnings.
            // Nothing detected or repaired it; it was cured only by luck, when a SECOND
            // splice at 09:19 happened to stall the socket long enough to trip the 15s
            // timeout and restart the reader. Reported upstream as go2rtc#2404.
            //
            // One reader run must equal one coherent timeline. Enforce that the moment the
            // splice is visible: killChild() lets the exit handler wipe initSegment and
            // fragments, drop in-flight consumers, and respawn in ~1s. The ring is
            // unavailable for ~5-10s, during which createStream() returns null and a
            // recording falls back to a direct dial -- which costs the pre-trigger history
            // for one event, against hours of silently poisoned clips.
            if (/RTP: PT=\d+: bad cseq/.test(s)) {
                this.log.warn(`[prebuffer:${this.name}] RTP discontinuity (${s.split("\n")[0]}); restarting reader to re-anchor the timeline`);
                this.killChild();
                return;
            }

            // A camera that renegotiates resolution MID-SESSION poisons the ring the same way
            // a timestamp re-base does, and for a structural reason: an fMP4 track declares its
            // dimensions once, in the init segment, and cannot re-declare them. After the first
            // switch the track no longer matches its samples -- video freezes while audio plays
            // on, for every clip cut from that ring, until something re-anchors it.
            //
            // Reported by @littlepope81 (potmat/homebridge-google-nest-sdm#238) on newer Nest
            // hardware that alternates 640x368 and 1920x1088 within one session, 31 and 9
            // decoder reinits in a day on two cameras. It reproduces under `-c copy` AND under
            // transcode-without-scale, so it is not an encoder problem -- the geometry change
            // reaches the muxer either way. None of the four cameras here has ever done it.
            //
            // Best-effort by construction: with `-c copy` ffmpeg does not decode, so whether a
            // geometry change surfaces on stderr at all depends on the build and on the parser
            // noticing the new SPS. When it does surface we re-anchor; when it does not we are
            // no worse off than before. Deliberately NOT thresholded like the DTS-clamp rule --
            // one genuine geometry change is already fatal to the init segment, so there is no
            // benign burst to ride out.
            const geometry = /Reinit context to (\d+x\d+)/.exec(s);
            if (geometry) {
                const seen = geometry[1];
                if (this.lastGeometry && this.lastGeometry !== seen) {
                    this.log.warn(`[prebuffer:${this.name}] video geometry changed mid-session (${this.lastGeometry} -> ${seen}); the init segment can no longer describe this track, so restarting the reader to re-anchor`);
                    this.lastGeometry = seen;
                    this.killChild();
                    return;
                }
                this.lastGeometry = seen;
                return;
            }

            // Backstop for a timestamp re-base that arrives WITHOUT a cseq jump, which the
            // rule above would never see. ffmpeg 6 spells it "Non-monotonous"; 7+ says
            // "Non-monotonic".
            //
            // Threshold, not hair-trigger. An ISOLATED clamp is survivable and common: one
            // camera here produces one every few minutes and every recording it fed still
            // closed reason=0. Restarting on each one cost ~5 ring resets in 13 minutes for
            // no benefit -- measured, after this backstop first shipped hair-triggered. What
            // actually poisons a ring is a SUSTAINED freeze: on 2026-08-03 the muxer clamped
            // roughly fifty times a second for 3h53m, because every packet after the re-base
            // was behind its predecessor. Requiring a burst separates the two: a real freeze
            // trips this within a second, an isolated hiccup never does.
            if (/Non-monoton(ous|ic) DTS in output stream/.test(s)) {
                const now = Date.now();
                this.dtsClamps.push(now);
                while (this.dtsClamps.length && now - this.dtsClamps[0] > DTS_CLAMP_WINDOW_MS) {
                    this.dtsClamps.shift();
                }

                if (this.dtsClamps.length >= DTS_CLAMP_THRESHOLD) {
                    this.log.warn(`[prebuffer:${this.name}] ${this.dtsClamps.length} dts clamps in ${DTS_CLAMP_WINDOW_MS / 1000}s -- the ring's timeline is frozen; restarting reader. Last: ${s.split("\n")[0]}`);
                    this.dtsClamps = [];
                    this.killChild();
                    return;
                }

                // Below the burst threshold this only REPORTS. Never swallow the raw line:
                // discarding it is exactly how the 3h53m poisoning stayed invisible, and the
                // rate is the thing worth watching. Throttled so a chatty camera cannot
                // flood the log.
                if (now - this.lastClampLogAt > CLAMP_LOG_THROTTLE_MS) {
                    this.lastClampLogAt = now;
                    this.log.warn(`[prebuffer:${this.name}] isolated dts clamp (${this.dtsClamps.length} in ${DTS_CLAMP_WINDOW_MS / 1000}s, threshold ${DTS_CLAMP_THRESHOLD}): ${s.split("\n")[0]}`);
                }
                return;
            }

            // Before this camera has EVER produced a fragment, ffmpeg's complaint is the
            // only thing that explains why the prebuffer is silently inert (e.g. an older
            // ffmpeg refusing Opus-in-MP4 without -strict experimental). Do not bury it.
            if (!this.everProduced) {
                this.log.warn(`[prebuffer:${this.name}] ffmpeg (ring never started): ${s}`);
            } else {
                this.log.debug(`[prebuffer:${this.name}] ffmpeg: ${s}`);
            }
        });

        // A failure to spawn at all (bad ffmpegPath -> ENOENT) emits 'error' and NEVER 'exit',
        // and only the exit handler schedules a restart. Without this the camera would sit
        // dead forever while the stall watchdog logged a warning every tick. `exitHandled`
        // keeps the two paths from both scheduling.
        child.on("error", e => {
            this.log.error(`[prebuffer:${this.name}] ffmpeg error: ${e}`);
            if (this.exitHandled || this.stopped) {
                return;
            }
            // `!child.pid` alone is the correct "never spawned" test. Do NOT also require
            // exitCode === null: on a spawn failure Node sets exitCode to the NEGATED ERRNO
            // (-2 for ENOENT) BEFORE emitting 'error', so that condition is never true and the
            // whole branch is dead -- which is exactly the bug this block was added to fix. A
            // kill-failure error on a live child always has a pid, so it cannot match here.
            if (!child.pid) {
                this.exitHandled = true;
                if (this.stallTimer) {
                    clearInterval(this.stallTimer);
                    this.stallTimer = undefined;
                }
                this.log.warn(`[prebuffer:${this.name}] ffmpeg never started; retrying in ${this.backoffMs}ms`);
                this.scheduleRestart();
            }
        });

        child.on("exit", (code, signal) => {
            if (this.exitHandled) {
                return;
            }
            this.exitHandled = true;

            if (this.stallTimer) {
                clearInterval(this.stallTimer);
                this.stallTimer = undefined;
            }

            if (this.stopped) {
                return;
            }

            this.restarts++;

            // A restarted ffmpeg emits a fresh ftyp/moov which may not describe the
            // old fragments; keeping them risks handing a consumer a mismatched init.
            this.initSegment = Buffer.alloc(0);
            this.fragments = [];

            // Drop half-parsed state HERE too, not just in killChild(): stdout buffered
            // before 'exit' can still arrive afterwards, and completing an old-timeline
            // moof+mdat into the new array is a backward-DTS splice that -codec:v copy
            // cannot mask. start() also resets these, but only after the backoff delay.
            this.pending = Buffer.alloc(0);
            this.pendingMoof = undefined;

            // The clamp window is per-run too, and forgetting that is harmful rather than
            // merely untidy. A run that dies holding, say, 15 clamps inside the last 10s
            // hands them to its replacement, which respawns after a >=1s backoff — still
            // inside the window. A handful of ordinary clamps from the NEW run then crosses
            // the threshold on a mixed count, and the burst detector kills a healthy reader
            // and destroys the in-flight consumer it was feeding, truncating a live
            // recording. Every other piece of per-run parse state is reset here; this was
            // the one that was not.
            this.dtsClamps = [];

            this.resetConsumers("prebuffer reader restarted; timeline discontinuity");

            // Reset backoff if it had been healthy: a stream that ran for minutes
            // and then dropped deserves a prompt retry, not the delay earned by one
            // that fails instantly.
            //
            // Gate on fragments produced BY THIS RUN, not on `everProduced`. `everProduced` is
            // a lifetime flag, so a reader that connected, delivered nothing for 60s and was
            // killed still satisfied "everProduced && ran > 30s" and reset the backoff to 1s.
            // That made the escalating backoff -- and the `stallKills >= 3` five-minute cap it
            // feeds -- unreachable for exactly the failure they exist to damp, turning a
            // starved camera into a 60s metronome of kill/respawn/re-dial against SDM.
            //
            // The run must ALSO have still been producing when it ended. Without the
            // recency test, a "trickle" run -- one fragment early, then starvation until the
            // 60s stall kill -- satisfies "produced && ran > 30s" and resets the backoff to
            // 1s, resurrecting the very metronome this gating exists to stop. A run that
            // exits or is killed while genuinely healthy has a recent lastProducedAt; one
            // killed for 60s of silence cannot.
            if (this.fragmentsThisRun > 0
                && Date.now() - startedAt > 30000
                && Date.now() - this.lastProducedAt < 30000) {
                this.backoffMs = 1000;
            }

            this.log.debug(`[prebuffer:${this.name}] reader exited (code=${code} signal=${signal}), retry in ${this.backoffMs}ms`);
            this.scheduleRestart();
        });
    }

    /** Destroy every in-flight consumer; their timeline is no longer valid. */
    private resetConsumers(reason: string): void {
        const streams = Array.from(this.activeStreams);
        this.activeStreams.clear();
        for (const st of streams) {
            try {
                st.destroy(new Error(reason));
            } catch (e) { /* already gone */ }
        }
        if (streams.length) {
            this.log.warn(`[prebuffer:${this.name}] ${reason} -- dropped ${streams.length} in-flight consumer(s)`);
        }
    }

    private scheduleRestart(): void {
        if (this.stopped || this.restartTimer) {
            return;
        }
        const delay = this.backoffMs;

        // Two ways a camera earns the long cap: it has produced nothing for five minutes,
        // or the stall watchdog has had to kill it repeatedly without a fragment in between.
        const sustainedOutage = this.lastProducedAt > 0 && (Date.now() - this.lastProducedAt) > 300000;
        const notRecovering = this.stallKills >= 3;
        const cap = (this.everProduced && !sustainedOutage && !notRecovering) ? 60000 : 300000;

        this.backoffMs = Math.min(this.backoffMs * 2, cap);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = undefined;
            this.start();
        }, delay);
        this.restartTimer.unref();
    }

    private consume(chunk: Buffer): void {
        // Once the run has ended, drop anything still arriving on its stdout. The exit handler
        // wipes the ring for a fresh timeline, and a COMPLETE late moof+mdat would otherwise
        // parse straight through to publish() and seed the new ring with an old-timeline
        // fragment -- a backward-DTS splice that `-codec:v copy` cannot mask. Resetting
        // `pending` there only covers a HALF-parsed box.
        if (this.exitHandled) {
            return;
        }

        this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;

        for (;;) {
            if (this.pending.length < 8) {
                return;
            }

            let size = this.pending.readUInt32BE(0);
            const type = this.pending.toString("latin1", 4, 8);
            let header = 8;

            if (size === 1) {
                if (this.pending.length < 16) {
                    return;
                }
                // 64-bit sizes are legal but never produced here; read the low word
                // and refuse anything that would not fit in a sane buffer.
                const hi = this.pending.readUInt32BE(8);
                const lo = this.pending.readUInt32BE(12);
                if (hi !== 0) {
                    this.log.error(`[prebuffer:${this.name}] absurd 64-bit box size, restarting reader`);
                    this.killChild();
                    return;
                }
                size = lo;
                header = 16;
            }

            if (size > MAX_BOX_BYTES) {
                this.log.error(`[prebuffer:${this.name}] box '${type}' declares ${size} bytes (>${MAX_BOX_BYTES}); parse desynced, restarting reader`);
                this.killChild();
                return;
            }

            if (size < header) {
                this.log.error(`[prebuffer:${this.name}] bad box size ${size} for '${type}', restarting reader`);
                this.killChild();
                return;
            }

            if (this.pending.length < size) {
                return;
            }

            const box = this.pending.subarray(0, size);
            this.pending = this.pending.subarray(size);

            if (INIT_BOXES.has(type)) {
                // ffmpeg only emits ftyp/moov once it has parsed the RTSP stream info, so
                // this marks "the session is established" for the fast-fail deadline.
                if (!this.sawInitThisRun) {
                    this.initAtThisRun = Date.now();
                }
                this.sawInitThisRun = true;
                this.initSegment = this.initSegment.length
                    ? Buffer.concat([this.initSegment, box])
                    : Buffer.from(box);
                continue;
            }

            if (SKIP_BOXES.has(type)) {
                continue;
            }

            if (type === "moof") {
                this.pendingMoof = Buffer.from(box);
                continue;
            }

            if (type === "mdat") {
                if (!this.pendingMoof) {
                    // An mdat with no moof cannot be framed; dropping it is the only
                    // safe move (a moof without its mdat would wedge a demuxer).
                    continue;
                }
                this.publish(Buffer.concat([this.pendingMoof, Buffer.from(box)]));
                this.pendingMoof = undefined;
                continue;
            }

            // Unknown box: ignore rather than guess at its meaning.
        }
    }

    private killChild(): void {
        // Drop half-parsed state with the child. Otherwise buffered stdout from the
        // dying process keeps hitting the corrupt-parse path, and a late chunk can
        // interleave with the next child's output through the same `pending`.
        this.pending = Buffer.alloc(0);
        this.pendingMoof = undefined;
        try {
            this.child?.kill("SIGKILL");
        } catch (e) { /* exit handler schedules the restart */ }
    }

    private publish(fragment: Buffer): void {
        this.everProduced = true;
        const now = Date.now();
        this.lastProducedAt = now;
        this.stallKills = 0;
        this.fragmentsThisRun++;

        this.fragments.push({t: now, data: fragment});
        this.totalFragments++;

        const cutoff = now - this.bufferSeconds * 1000;
        while (this.fragments.length && this.fragments[0].t < cutoff) {
            this.fragments.shift();
        }
        while (this.fragments.length > MAX_FRAGMENTS) {
            this.fragments.shift();
        }

        for (const sub of this.subscribers) {
            try {
                sub(fragment);
            } catch (e) {
                this.log.debug(`[prebuffer:${this.name}] subscriber threw: ${e}`);
            }
        }
    }

    /**
     * Fragments buffered at or after `sinceEpochMs`, plus the init segment.
     * Returns null when no init segment has been seen yet -- the caller must fall
     * back rather than emit a headless stream.
     */
    history(sinceEpochMs: number): PrebufferHistory | null {
        if (!this.initSegment.length) {
            return null;
        }

        // An init segment alone is NOT a usable ring. If there are no fragments -- or the
        // newest is stale, meaning the reader is alive but has stopped producing -- report
        // unavailable so the caller dials the camera directly instead of being fed a pipe
        // that never delivers media. A missing prebuffer costs pre-trigger footage; a silent
        // one costs the entire clip.
        if (!this.fragments.length) {
            return null;
        }

        const newest = this.fragments[this.fragments.length - 1].t;
        if (Date.now() - newest > STALE_RING_MS) {
            this.log.warn(`[prebuffer:${this.name}] newest fragment is ${Math.round((Date.now() - newest) / 1000)}s old; treating ring as unavailable`);
            return null;
        }

        const usable = this.fragments.filter(f => f.t >= sinceEpochMs).map(f => f.data);
        if (!usable.length) {
            return null;
        }

        return {
            init: this.initSegment,
            fragments: usable,
            oldestAvailable: this.fragments[0].t,
        };
    }

    stop(): void {
        this.stopped = true;
        if (this.stallTimer) {
            clearInterval(this.stallTimer);
            this.stallTimer = undefined;
        }
        this.resetConsumers("prebuffer stopped");
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = undefined;
        }
        this.killChild();
        this.child = undefined;
        this.subscribers.clear();
    }

    stats(): PrebufferStats {
        const span = this.fragments.length >= 2
            ? (this.fragments[this.fragments.length - 1].t - this.fragments[0].t) / 1000
            : 0;
        return {
            fragments: this.fragments.length,
            seconds: Math.round(span * 100) / 100,
            haveInit: this.initSegment.length > 0,
            subscribers: this.subscribers.size,
            totalFragments: this.totalFragments,
            restarts: this.restarts,
        };
    }
}

export class PrebufferManager {
    private readonly log: Logger;
    private readonly ffmpegPath: string;
    private readonly rtspBase: string;
    private readonly bufferSeconds: number;
    private readonly buffers = new Map<string, CameraBuffer>();

    /**
     * @param log            Homebridge logger
     * @param ffmpegPath     path to ffmpeg
     * @param rtspBase       local RTSP restreamer base, e.g. rtsp://127.0.0.1:8554
     * @param bufferSeconds  how much history to retain per camera
     */
    constructor(log: Logger, ffmpegPath: string, rtspBase?: string, bufferSeconds?: number) {
        this.log = log;
        this.ffmpegPath = ffmpegPath;
        this.rtspBase = (rtspBase || "rtsp://127.0.0.1:8554").replace(/\/+$/, "");
        this.bufferSeconds = bufferSeconds || DEFAULT_BUFFER_SECONDS;
    }

    /** Stop one camera's ring (HKSV switched off for it) without touching others. */
    release(cameraKey: string): void {
        const buf = this.buffers.get(cameraKey);
        if (buf) {
            buf.stop();
            this.buffers.delete(cameraKey);
        }
    }

    ensure(cameraKey: string): void {
        let buf = this.buffers.get(cameraKey);
        if (!buf) {
            buf = new CameraBuffer(this.log, cameraKey, `${this.rtspBase}/${cameraKey}`, this.ffmpegPath, this.bufferSeconds);
            this.buffers.set(cameraKey, buf);
            buf.start();
        }
    }

    /**
     * A Readable delivering [init][history since sinceEpochMs][live...].
     *
     * Subscribe happens before the history snapshot, and the two run in one
     * synchronous block while `publish()` can only run from an async stdout 'data'
     * event -- so no fragment can land between them. That yields neither a gap nor
     * a duplicate, and the ordering must stay synchronous: inserting an `await`
     * would make an untested duplicate-safety claim load-bearing.
     *
     * Note `f.t` is stamped when a fragment COMPLETES, so the fragment containing
     * the anchor instant is filtered out: expect up to ~1.67s less history than
     * requested, plus any NTP skew between Google's clock and this host. The
     * pre-roll margin absorbs both.
     *
     * Returns null if the buffer has no init segment yet, so the caller can fall
     * back to dialling the camera directly.
     */
    createStream(cameraKey: string, sinceEpochMs: number): Readable | null {
        // Look up, do NOT create. Implicitly creating the ring here resurrected
        // rings that updateRecordingActive(false) had just released, and they then ran
        // until the next toggle. A missing ring means the caller falls back to dialling
        // the camera directly, which is the correct behaviour.
        const buf = this.buffers.get(cameraKey);
        if (!buf) {
            this.log.debug(`[prebuffer:${cameraKey}] no ring for this camera; caller must fall back`);
            return null;
        }

        const queue: Buffer[] = [];
        let flowing = false;
        let stream: Readable | undefined;

        // Deadman: armed once history is queued, cleared by each live fragment. A reader that
        // stalls between our snapshot and the live continuation would otherwise leave ffmpeg
        // waiting on input that never comes -- we would have handed over perfectly good
        // pre-trigger footage and then hung, and the hub discards the clip entirely on timeout.
        let deadman: NodeJS.Timeout | undefined;

        // Set once EOF has been pushed. Everything that could push afterwards must check it:
        // `stream.push(chunk)` after `push(null)` throws ERR_STREAM_PUSH_AFTER_EOF, which
        // destroys the stream WITH an error instead of ending it cleanly -- turning the
        // slightly-short clip the deadman exists to save into an errored one. Reachable
        // whenever the recorder is applying backpressure (flowing === false, fragments still
        // queued) at the moment the reader stalls: the deadman fires, then the consumer
        // drains, read() calls pump(), and pump pushes into an ended stream.
        let ended = false;

        const armDeadman = () => {
            if (deadman) {
                clearTimeout(deadman);
            }
            deadman = setTimeout(() => {
                this.log.warn(`[prebuffer:${cameraKey}] no live fragment for ${LIVE_FLOW_DEADMAN_MS / 1000}s; closing the stream so the clip finalizes with the history we already sent`);
                ended = true;
                // Unsubscribe here rather than waiting for 'close'. Otherwise late live
                // fragments keep re-arming this timer and piling into a queue nobody will
                // ever read, until the overflow backstop or a reader restart clears it.
                buf.subscribers.delete(onFragment);
                queue.length = 0;
                try {
                    stream?.push(null);
                } catch (e) { /* already ended */ }
            }, LIVE_FLOW_DEADMAN_MS);
            deadman.unref();
        };

        const pump = () => {
            if (!stream || ended) {
                return;
            }
            while (queue.length) {
                const chunk = queue.shift()!;
                if (!stream.push(chunk)) {
                    flowing = false;
                    return;
                }
            }
            flowing = true;
        };

        const onFragment: FragmentSubscriber = (f: Buffer) => {
            if (ended) {
                return;
            }
            armDeadman();
            // Backstop: if the consumer never drains (ffmpeg died before its stdin
            // was piped, or was killed while the reader was down so no write ever
            // raised EPIPE), this queue would otherwise grow at ~150KB/s forever.
            if (queue.length >= MAX_QUEUED_FRAGMENTS) {
                this.log.error(`[prebuffer:${cameraKey}] consumer not draining (${queue.length} fragments queued); destroying it`);
                try {
                    stream?.destroy(new Error("prebuffer consumer stalled"));
                } catch (e) { /* fall through */ }
                return;
            }
            queue.push(f);
            if (flowing) {
                pump();
            }
        };

        buf.subscribers.add(onFragment);
        const hist = buf.history(sinceEpochMs);
        if (!hist) {
            buf.subscribers.delete(onFragment);
            const why = !buf.initSegment.length ? "no init segment yet"
                : !buf.fragments.length ? "ring is empty"
                    : "no fragments within the requested window";
            this.log.warn(`[prebuffer:${cameraKey}] ${why}; falling back to a direct dial`);
            return null;
        }

        stream = new Readable({
            read() {
                flowing = true;
                pump();
            },
        });

        buf.activeStreams.add(stream);

        // 'close' fires on destroy() from any direction; belt-and-braces on 'error'
        // too, since a destroy(err) emits both and the Set must not retain either.
        const cleanupAll = () => {
            if (deadman) {
                clearTimeout(deadman);
                deadman = undefined;
            }
            buf.subscribers.delete(onFragment);
            if (stream) {
                buf.activeStreams.delete(stream);
            }
            queue.length = 0;
        };

        stream.once("close", cleanupAll);
        stream.once("error", cleanupAll);

        queue.unshift(...hist.fragments);
        queue.unshift(hist.init);

        const recovered = hist.oldestAvailable
            ? Math.round((Date.now() - Math.max(hist.oldestAvailable, sinceEpochMs)) / 100) / 10
            : 0;
        this.log.info(`[prebuffer:${cameraKey}] serving ${hist.fragments.length} buffered fragments (~${recovered}s of history)`);

        armDeadman();
        return stream;
    }

    stats(): Record<string, PrebufferStats> {
        const out: Record<string, PrebufferStats> = {};
        for (const [k, v] of this.buffers) {
            out[k] = v.stats();
        }
        return out;
    }

    stopAll(): void {
        for (const buf of this.buffers.values()) {
            buf.stop();
        }
        this.buffers.clear();
    }
}

// StreamingDelegate is constructed per camera, but the buffers must be shared and
// long-lived (they run whether or not a recording is in progress), so the manager
// is a module singleton rather than per-delegate state.
let _manager: PrebufferManager | undefined;

export function getPrebufferManager(log: Logger, ffmpegPath: string, rtspBase?: string, bufferSeconds?: number): PrebufferManager {
    if (!_manager) {
        _manager = new PrebufferManager(log, ffmpegPath, rtspBase, bufferSeconds);
    }
    return _manager;
}
