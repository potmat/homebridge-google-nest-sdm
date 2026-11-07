import { NestStream } from './NestStreamer';
interface ReusableStreamer { initialize(): Promise<NestStream>; teardown(): Promise<void>; requestKeyframe?(): void }
interface Entry { busy: boolean; createdAt: number; streamer: ReusableStreamer; ready: Promise<NestStream>; timer?: NodeJS.Timeout }
// Inputs contain private UDP ports: reuse only after the previous local consumer
// has exited. Concurrent consumers must retain independent inputs.
export class StreamLeasePool {
    private idleMs: number;
    private maxAgeMs: number;
    private now: () => number;
    private schedule: typeof setTimeout;
    private cancel: typeof clearTimeout;
    private cameras: WeakMap<object, Set<Entry>>;
    constructor({ idleMs = 60000, maxAgeMs = 240000, now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
        this.idleMs = idleMs; this.maxAgeMs = maxAgeMs; this.now = now; this.schedule = schedule; this.cancel = cancel;
        this.cameras = new WeakMap();
    }
    lease(camera: object, factory: () => Promise<ReusableStreamer>) {
        const pool = this;
        let entry: Entry | undefined, released = false, initialized = false;
        return {
            async initialize() {
                if (released) throw new Error('Camera stream lease cancelled');
                const entries = pool.cameras.get(camera) || new Set<Entry>();
                pool.cameras.set(camera, entries);
                entry = [...entries].find(e => !e.busy && pool.now() - e.createdAt < pool.maxAgeMs);
                if (entry) {
                    pool.cancel(entry.timer);
                    entry.busy = true;
                    // A newly attached decoder needs complete parameter sets/IDR.
                    entry.streamer.requestKeyframe?.();
                } else {
                    const streamer = await factory();
                    // teardown may have arrived while protocol discovery awaited.
                    if (released) { await streamer.teardown(); throw new Error('Camera stream lease cancelled'); }
                    entry = { busy: true, createdAt: pool.now(), streamer, ready: streamer.initialize() };
                    entries.add(entry);
                }
                try {
                    const input = await entry.ready;
                    if (released) throw new Error('Camera stream lease cancelled');
                    initialized = true;
                    return input;
                } catch (error) {
                    entries.delete(entry);
                    pool.cancel(entry.timer);
                    await entry.streamer.teardown().catch(() => {});
                    throw error;
                }
            },
            async teardown() {
                if (released) return;
                released = true;
                if (!entry) return;
                const entries = pool.cameras.get(camera);
                // Cancellation closes local sockets immediately, even while a
                // Google negotiation is pending. Late tokens are cleaned up by
                // the streamer's cancellation guard rather than made reusable.
                if (!initialized) { entries?.delete(entry); await entry.streamer.teardown().catch(() => {}); return; }
                try { await entry.ready; } catch (_) { entries?.delete(entry); await entry.streamer.teardown().catch(() => {}); return; }
                entry.busy = false;
                const remaining = pool.maxAgeMs - (pool.now() - entry.createdAt);
                const close = () => {
                    entries?.delete(entry!);
                    entry!.streamer.teardown().catch(() => {});
                };
                if (remaining <= 0) close();
                else {
                    entry.timer = pool.schedule(close, Math.min(pool.idleMs, remaining));
                    entry.timer?.unref?.();
                }
            }
        };
    }
}
