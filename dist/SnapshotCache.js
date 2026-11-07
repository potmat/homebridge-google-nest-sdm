"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SNAPSHOT_FILTER = exports.IDLE_TIMEOUT = exports.CAPTURE_TIMEOUT = exports.TTL = exports.SnapshotCache = void 0;
const child_process_1 = require("child_process");
const NestStreamer_1 = require("./NestStreamer");
const TTL = 10000;
exports.TTL = TTL;
// Refresh locally once per second while a decoder is already running. Select
// emits the first frame immediately and bounds JPEG encoding/scaling work;
// live video output remains independent and no additional Google call is made.
const SNAPSHOT_FILTER = 'select=gte(t-prev_selected_t\\,1)+isnan(prev_selected_t),scale=640:-2';
exports.SNAPSHOT_FILTER = SNAPSHOT_FILTER;
const CAPTURE_TIMEOUT = 20000;
exports.CAPTURE_TIMEOUT = CAPTURE_TIMEOUT;
const IDLE_TIMEOUT = 120000;
exports.IDLE_TIMEOUT = IDLE_TIMEOUT;
const MAX_JPEG = 2 * 1024 * 1024;
class SnapshotCache {
    constructor(camera, config, capture) {
        this.updatedAt = 0;
        this.camera = camera;
        this.config = config;
        this.capture = capture || (() => this.captureFrame());
        this.buffers = new Map();
        this.waiters = new Set();
        this.nextAttempt = 0;
        this.failures = 0;
        this.liveRequests = new Set();
    }
    consume(data, id) {
        let buffer = Buffer.concat([this.buffers.get(id) || Buffer.alloc(0), data]);
        if (buffer.length > MAX_JPEG)
            buffer = buffer.subarray(-MAX_JPEG);
        while (true) {
            const start = buffer.indexOf(Buffer.from([255, 216]));
            if (start < 0) {
                buffer = buffer.subarray(-1);
                break;
            }
            if (start > 0)
                buffer = buffer.subarray(start);
            const end = buffer.indexOf(Buffer.from([255, 217]), 2);
            if (end < 0)
                break;
            this.frame = Buffer.from(buffer.subarray(0, end + 2));
            this.updatedAt = Date.now();
            this.failures = 0;
            this.nextAttempt = 0;
            for (const resolve of this.waiters)
                resolve(this.frame);
            this.waiters.clear();
            buffer = buffer.subarray(end + 2);
        }
        this.buffers.set(id, buffer);
    }
    end(id) { this.buffers.delete(id); }
    async get() {
        this.touchCapture();
        // consume() continually replaces this single frame. TTL controls only
        // whether an idle/stalled feed needs refreshing, never a frozen 10s copy.
        if (this.frame && Date.now() - this.updatedAt < TTL)
            return this.frame;
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
        let responseTimer;
        const frame = this.pending ? await Promise.race([
            this.pending,
            new Promise(resolve => { responseTimer = setTimeout(() => resolve(null), this.frame ? 1500 : 4500); })
        ]).finally(() => clearTimeout(responseTimer)) : null;
        if (frame)
            return frame;
        if (this.frame)
            return this.frame;
        throw new Error('No current camera snapshot available; refresh is in backoff');
    }
    touchCapture() {
        var _a, _b;
        const session = this.captureSession;
        if (!session)
            return;
        clearTimeout(session.idleTimer);
        session.idleTimer = setTimeout(() => { this.stopCapture().catch(() => { }); }, IDLE_TIMEOUT);
        (_b = (_a = session.idleTimer).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
    }
    async stopCapture() {
        const session = this.captureSession;
        if (!session)
            return;
        this.captureSession = null;
        session.cancelled = true;
        clearTimeout(session.idleTimer);
        clearTimeout(session.maxTimer);
        if (session.child && session.child.exitCode == null && session.child.signalCode == null) {
            await new Promise(resolve => { session.child.once('close', () => resolve()); session.child.kill('SIGKILL'); });
        }
        this.end(session.id);
        if (session.streamer)
            await session.streamer.teardown();
    }
    waitForFrame(timeout = CAPTURE_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const ready = (frame) => { clearTimeout(timer); this.waiters.delete(ready); resolve(frame); };
            const timer = setTimeout(() => { this.waiters.delete(ready); reject(new Error('No fresh camera frame')); }, timeout);
            this.waiters.add(ready);
        });
    }
    async captureFrame() {
        var _a, _b;
        if (this.buffers.size || this.liveRequests.size)
            return this.waitForFrame();
        const session = { id: Symbol('snapshot-feed'), cancelled: false };
        this.captureSession = session;
        this.touchCapture();
        session.maxTimer = setTimeout(() => { this.stopCapture().catch(() => { }); }, 240000);
        (_b = (_a = session.maxTimer).unref) === null || _b === void 0 ? void 0 : _b.call(_a);
        const fresh = this.waitForFrame();
        const launch = (async () => {
            session.streamer = await (0, NestStreamer_1.getStreamer)(this.camera.snapshotLogger, this.camera, this.config);
            if (session.cancelled)
                return;
            const stream = await session.streamer.initialize();
            if (session.cancelled) {
                await session.streamer.teardown();
                return;
            }
            let binary = require('ffmpeg-for-homebridge') || 'ffmpeg';
            const child = session.child = (0, child_process_1.spawn)(binary, ['-hide_banner', '-loglevel', 'error', ...stream.args.split(/\s+/), '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', SNAPSHOT_FILTER, '-vsync', 'vfr', '-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2pipe', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
            this.buffers.set(session.id, Buffer.alloc(0));
            child.stdin.on('error', () => { });
            child.stdin.end(stream.stdin || undefined);
            child.stderr.resume(); // Never retain credential-bearing diagnostics.
            child.stdout.on('data', data => this.consume(data, session.id));
            child.once('error', () => { if (this.captureSession === session)
                this.stopCapture().catch(() => { }); });
            child.once('close', () => { if (this.captureSession === session)
                this.stopCapture().catch(() => { }); });
        })();
        // Keep one ingest alive across thumbnail refreshes; stop after 120s idle.
        // Live view explicitly preempts this feed before requesting its own stream.
        try {
            return await Promise.race([fresh, launch.then(() => fresh)]);
        }
        catch (error) {
            if (this.captureSession === session)
                await this.stopCapture();
            throw error;
        }
    }
}
exports.SnapshotCache = SnapshotCache;
//# sourceMappingURL=SnapshotCache.js.map