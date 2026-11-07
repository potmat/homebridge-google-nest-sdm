import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { getStreamer, Streamer } from './NestStreamer';
import { Camera } from './sdm/Camera';
import { Config } from './Config';
const TTL = 10000;
// Refresh locally once per second while a decoder is already running. Select
// emits the first frame immediately and bounds JPEG encoding/scaling work;
// live video output remains independent and no additional Google call is made.
const SNAPSHOT_FILTER = 'select=gte(t-prev_selected_t\\,1)+isnan(prev_selected_t),scale=640:-2';
const CAPTURE_TIMEOUT = 20000;
const IDLE_TIMEOUT = 120000;
const MAX_JPEG = 2 * 1024 * 1024;
// Memory-only latest-frame cache. Expired requests await a shared bounded refresh;
// failures retain the last good frame without changing its capture time.
type CaptureSession = { id: symbol; cancelled: boolean; idleTimer?: NodeJS.Timeout; maxTimer?: NodeJS.Timeout; child?: ChildProcessWithoutNullStreams; streamer?: Streamer };
export class SnapshotCache {
    camera: Camera;
    config: Config;
    capture: () => Promise<Buffer>;
    buffers: Map<string | symbol, Buffer>;
    waiters: Set<(frame: Buffer) => void>;
    nextAttempt: number;
    failures: number;
    liveRequests: Set<string>;
    frame?: Buffer;
    updatedAt = 0;
    pending?: Promise<Buffer | null> | null;
    captureSession?: CaptureSession | null;
    constructor(camera: Camera, config: Config, capture?: () => Promise<Buffer>) {
        this.camera = camera;
        this.config = config;
        this.capture = capture || (() => this.captureFrame());
        this.buffers = new Map();
        this.waiters = new Set();
        this.nextAttempt = 0;
        this.failures = 0;
        this.liveRequests = new Set();
    }
    consume(data: Buffer, id: string | symbol) {
        let buffer = Buffer.concat([this.buffers.get(id) || Buffer.alloc(0), data]);
        if (buffer.length > MAX_JPEG) buffer = buffer.subarray(-MAX_JPEG);
        while (true) {
            const start = buffer.indexOf(Buffer.from([255,216]));
            if (start < 0) { buffer = buffer.subarray(-1); break; }
            if (start > 0) buffer = buffer.subarray(start);
            const end = buffer.indexOf(Buffer.from([255,217]), 2);
            if (end < 0) break;
            this.frame = Buffer.from(buffer.subarray(0, end + 2));
            this.updatedAt = Date.now();
            this.failures = 0;
            this.nextAttempt = 0;
            for (const resolve of this.waiters) resolve(this.frame);
            this.waiters.clear();
            buffer = buffer.subarray(end + 2);
        }
        this.buffers.set(id, buffer);
    }
    end(id: string | symbol) { this.buffers.delete(id); }
    async get() {
        this.touchCapture();
        // consume() continually replaces this single frame. TTL controls only
        // whether an idle/stalled feed needs refreshing, never a frozen 10s copy.
        if (this.frame && Date.now() - this.updatedAt < TTL) return this.frame;
        if (!this.pending && Date.now() >= this.nextAttempt) {
            this.nextAttempt = Date.now() + TTL;
            this.pending = Promise.resolve().then(() => this.capture()).then(frame => {
                this.frame = frame;
                this.updatedAt = Date.now();
                this.failures = 0;
                return frame;
            }).catch(() => {
                this.failures++;
                this.nextAttempt = Date.now() + Math.min(300000, 60000 * 2 ** Math.min(this.failures - 1, 4));
                this.camera.snapshotLogger.warn('Snapshot refresh failed; backing off. Last good frame age: ' + (this.updatedAt ? Math.round((Date.now() - this.updatedAt) / 1000) + 's' : 'unavailable'), this.camera.getDisplayName());
                return null;
            }).finally(() => { this.pending = null; });
        }
        // Home's snapshot request deadline is shorter than some Google startups.
        // Continue the shared refresh in the background, returning an existing
        // frame promptly rather than making a healthy accessory "No Response".
        let responseTimer: NodeJS.Timeout | undefined;
        const frame = this.pending ? await Promise.race([
            this.pending,
            new Promise<null>(resolve => { responseTimer = setTimeout(() => resolve(null), this.frame ? 1500 : 4500); })
        ]).finally(() => clearTimeout(responseTimer)) : null;
        if (frame) return frame;
        if (this.frame) return this.frame;
        throw new Error('No current camera snapshot available; refresh is in backoff');
    }
    touchCapture() {
        const session = this.captureSession;
        if (!session) return;
        clearTimeout(session.idleTimer);
        session.idleTimer = setTimeout(() => { this.stopCapture().catch(() => {}); }, IDLE_TIMEOUT);
        session.idleTimer.unref?.();
    }
    async stopCapture() {
        const session = this.captureSession;
        if (!session) return;
        this.captureSession = null;
        session.cancelled = true;
        clearTimeout(session.idleTimer);
        clearTimeout(session.maxTimer);
        if (session.child && session.child.exitCode == null && session.child.signalCode == null) {
            await new Promise<void>(resolve => { session.child!.once('close', () => resolve()); session.child!.kill('SIGKILL'); });
        }
        this.end(session.id);
        if (session.streamer) await session.streamer.teardown();
    }
    waitForFrame(timeout = CAPTURE_TIMEOUT) {
        return new Promise<Buffer>((resolve, reject) => {
            const ready = (frame: Buffer) => { clearTimeout(timer); this.waiters.delete(ready); resolve(frame); };
            const timer = setTimeout(() => { this.waiters.delete(ready); reject(new Error('No fresh camera frame')); }, timeout);
            this.waiters.add(ready);
        });
    }
    async captureFrame() {
        if (this.buffers.size || this.liveRequests.size) return this.waitForFrame();
        const session: CaptureSession = { id: Symbol('snapshot-feed'), cancelled: false };
        this.captureSession = session;
        this.touchCapture();
        session.maxTimer = setTimeout(() => { this.stopCapture().catch(() => {}); }, 240000);
        session.maxTimer.unref?.();
        const fresh = this.waitForFrame();
        const launch = (async () => {
            session.streamer = await getStreamer(this.camera.snapshotLogger, this.camera, this.config);
            if (session.cancelled) return;
            const stream = await session.streamer.initialize();
            if (session.cancelled) { await session.streamer.teardown(); return; }
            let binary = require('ffmpeg-for-homebridge') || 'ffmpeg';
            const child = session.child = spawn(binary, ['-hide_banner','-loglevel','error', ...stream.args.split(/\s+/), '-map','0:v:0','-an','-sn','-dn','-vf',SNAPSHOT_FILTER,'-vsync','vfr','-c:v','mjpeg','-q:v','5','-f','image2pipe','pipe:1'], {stdio:['pipe','pipe','pipe']});
            this.buffers.set(session.id, Buffer.alloc(0));
            child.stdin.on('error', () => {});
            child.stdin.end(stream.stdin || undefined);
            child.stderr.resume(); // Never retain credential-bearing diagnostics.
            child.stdout.on('data', data => this.consume(data, session.id));
            child.once('error', () => { if (this.captureSession === session) this.stopCapture().catch(() => {}); });
            child.once('close', () => { if (this.captureSession === session) this.stopCapture().catch(() => {}); });
        })();
        // Keep one ingest alive across thumbnail refreshes; stop after 120s idle.
        // Live view explicitly preempts this feed before requesting its own stream.
        try { return await Promise.race([fresh, launch.then(() => fresh)]); }
        catch (error) { if (this.captureSession === session) await this.stopCapture(); throw error; }
    }
}
export { TTL, CAPTURE_TIMEOUT, IDLE_TIMEOUT, SNAPSHOT_FILTER };
