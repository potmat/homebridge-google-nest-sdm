import buffer = require('buffer');

// Node 25 removed buffer.SlowBuffer. buffer-equal-constant-time, reached through
// @google-cloud/pubsub -> google-auth-library -> jws -> jwa (still a dependency of the
// latest jwa, 2.0.1), reads SlowBuffer.prototype at load time. On Node 25+ requiring
// Pub/Sub therefore throws and Homebridge refuses to load the plugin at all. Nothing in
// that chain calls SlowBuffer itself; it only needs an object with a prototype to read.
// This must be imported before anything that loads google-auth-library.
const exported = buffer as unknown as {SlowBuffer?: unknown};
if (exported.SlowBuffer === undefined) {
    try {
        Object.defineProperty(buffer, 'SlowBuffer', {
            value: function SlowBuffer(size: number) {
                return Buffer.allocUnsafeSlow(size);
            },
            configurable: true,
            writable: true,
        });
    } catch {
        // If the module namespace is not extensible, loading will fail exactly as before.
    }
}
