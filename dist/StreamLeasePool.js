"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamLeasePool = void 0;
// Inputs contain private UDP ports: reuse only after the previous local consumer
// has exited. Concurrent consumers must retain independent inputs.
class StreamLeasePool {
    constructor({ idleMs = 60000, maxAgeMs = 240000, now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
        this.idleMs = idleMs;
        this.maxAgeMs = maxAgeMs;
        this.now = now;
        this.schedule = schedule;
        this.cancel = cancel;
        this.cameras = new WeakMap();
    }
    lease(camera, factory) {
        const pool = this;
        let entry, released = false, initialized = false;
        return {
            async initialize() {
                var _a, _b;
                if (released)
                    throw new Error('Camera stream lease cancelled');
                const entries = pool.cameras.get(camera) || new Set();
                pool.cameras.set(camera, entries);
                entry = [...entries].find(e => !e.busy && pool.now() - e.createdAt < pool.maxAgeMs);
                if (entry) {
                    pool.cancel(entry.timer);
                    entry.busy = true;
                    // A newly attached decoder needs complete parameter sets/IDR.
                    (_b = (_a = entry.streamer).requestKeyframe) === null || _b === void 0 ? void 0 : _b.call(_a);
                }
                else {
                    const streamer = await factory();
                    // teardown may have arrived while protocol discovery awaited.
                    if (released) {
                        await streamer.teardown();
                        throw new Error('Camera stream lease cancelled');
                    }
                    entry = { busy: true, createdAt: pool.now(), streamer, ready: streamer.initialize() };
                    entries.add(entry);
                }
                try {
                    const input = await entry.ready;
                    if (released)
                        throw new Error('Camera stream lease cancelled');
                    initialized = true;
                    return input;
                }
                catch (error) {
                    entries.delete(entry);
                    pool.cancel(entry.timer);
                    await entry.streamer.teardown().catch(() => { });
                    throw error;
                }
            },
            async teardown() {
                var _a, _b;
                if (released)
                    return;
                released = true;
                if (!entry)
                    return;
                const entries = pool.cameras.get(camera);
                // Cancellation closes local sockets immediately, even while a
                // Google negotiation is pending. Late tokens are cleaned up by
                // the streamer's cancellation guard rather than made reusable.
                if (!initialized) {
                    entries === null || entries === void 0 ? void 0 : entries.delete(entry);
                    await entry.streamer.teardown().catch(() => { });
                    return;
                }
                try {
                    await entry.ready;
                }
                catch (_) {
                    entries === null || entries === void 0 ? void 0 : entries.delete(entry);
                    await entry.streamer.teardown().catch(() => { });
                    return;
                }
                entry.busy = false;
                const remaining = pool.maxAgeMs - (pool.now() - entry.createdAt);
                const close = () => {
                    entries === null || entries === void 0 ? void 0 : entries.delete(entry);
                    entry.streamer.teardown().catch(() => { });
                };
                if (remaining <= 0)
                    close();
                else {
                    entry.timer = pool.schedule(close, Math.min(pool.idleMs, remaining));
                    (_b = (_a = entry.timer) === null || _a === void 0 ? void 0 : _a.unref) === null || _b === void 0 ? void 0 : _b.call(_a);
                }
            }
        };
    }
}
exports.StreamLeasePool = StreamLeasePool;
//# sourceMappingURL=StreamLeasePool.js.map