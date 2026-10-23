"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const child_process_1 = require("child_process");
const net_1 = require("net");
const stream_1 = require("stream");
class HksvStreamer {
    constructor(log, nestStream, audioOutputArgs, videoOutputArgs, debugMode) {
        this.destroyed = false;
        this.nestStream = nestStream;
        this.debugMode = debugMode;
        this.log = log;
        this.connectPromise = new Promise(resolve => this.connectResolve = resolve);
        this.server = (0, net_1.createServer)(this.handleConnection.bind(this));
        this.ffmpegPath = require('ffmpeg-for-homebridge');
        if (!this.ffmpegPath)
            this.ffmpegPath = 'ffmpeg';
        this.args = [];
        this.args.push(...nestStream.args.split(/ /g));
        this.args.push(...audioOutputArgs);
        this.args.push("-f", "mp4");
        this.args.push(...videoOutputArgs);
        this.args.push("-fflags", "+genpts", "-reset_timestamps", "1");
        this.args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof");
    }
    convertStringToStream(stringToConvert) {
        const stream = new stream_1.Readable();
        stream._read = () => { };
        stream.push(stringToConvert);
        stream.push(null);
        return stream;
    }
    async start() {
        var _a, _b;
        this.log.debug('HksvStreamer start command received.');
        const promise = (0, events_1.once)(this.server, "listening");
        this.server.listen(); // listen on random port
        await promise;
        if (this.destroyed) {
            // destroy() ran while we were awaiting 'listening'. Close the server we just
            // opened; returning without it leaves a listening socket for the life of the
            // process.
            try {
                this.server.close(() => { });
            }
            catch (e) { /* not listening */ }
            return;
        }
        const port = this.server.address().port;
        this.args.push("tcp://127.0.0.1:" + port);
        this.log.debug(this.ffmpegPath + " " + this.args.join(" "));
        this.childProcess = (0, child_process_1.spawn)(this.ffmpegPath, this.args, { env: process.env, stdio: 'pipe' });
        this.childProcess.on('error', (error) => {
            this.log.error(error.message);
            this.handleDisconnect();
        });
        this.childProcess.on('exit', this.handleDisconnect.bind(this));
        if (!this.childProcess.stdin && this.nestStream.stdin) {
            this.log.error('HksvStreamer failed to start stream: input to ffmpeg was provided as stdin, but the process does not support stdin.');
        }
        if (this.childProcess.stdin) {
            if (this.nestStream.stdin) {
                const sdpStream = this.convertStringToStream(this.nestStream.stdin);
                sdpStream.resume();
                sdpStream.pipe(this.childProcess.stdin);
            }
            else if (this.nestStream.stdinStream) {
                // Prebuffer path: a continuous fragmented-MP4 byte stream, not an SDP.
                const src = this.nestStream.stdinStream;
                // ffmpeg exiting first raises EPIPE on the writer; an unhandled 'error'
                // on stdin would take the whole Homebridge process down rather than end
                // one recording.
                this.childProcess.stdin.on('error', () => {
                    try {
                        src.destroy();
                    }
                    catch (e) { /* already gone */ }
                });
                // Destroying a piped Readable does NOT end the destination Writable, so
                // without this ffmpeg blocks on input forever whenever the prebuffer
                // consumer dies (reader restart, HKSV disabled mid-recording, the stall
                // backstop) -- the generator yields nothing and the only exit is the
                // Apple hub's ~16s timeout, losing the clip's tail or the whole clip.
                // Ending stdin lets ffmpeg flush and finalize the fragmented MP4.
                //
                // Capture the child locally: destroy() sets this.childProcess = undefined
                // synchronously, but this handler fires asynchronously afterwards, so a
                // `this.childProcess` guard could never pass and stdin.end() would never
                // run on the normal path -- which is why ffmpeg had to be SIGKILLed every
                // time before this was added.
                const child = this.childProcess;
                src.once('close', () => {
                    try {
                        if (child.stdin && !child.stdin.destroyed) {
                            child.stdin.end();
                        }
                    }
                    catch (e) { /* ffmpeg already gone */ }
                });
                src.pipe(this.childProcess.stdin);
            }
        }
        if (this.debugMode) {
            (_a = this.childProcess.stdout) === null || _a === void 0 ? void 0 : _a.on("data", data => this.log.debug(data.toString()));
            (_b = this.childProcess.stderr) === null || _b === void 0 ? void 0 : _b.on("data", data => this.log.debug(data.toString()));
        }
    }
    destroy() {
        var _a, _b, _c;
        this.log.debug('HksvStreamer destroy command received, ending process.');
        const child = this.childProcess;
        // Give ffmpeg EOF on stdin BEFORE signalling it, so it can flush and exit on its
        // own. Destroying the ring's Readable also drops this recording's subscription,
        // which is what stops a dead recording from holding the prebuffer open.
        try {
            (_a = this.nestStream.stdinStream) === null || _a === void 0 ? void 0 : _a.destroy();
        }
        catch (e) { /* nothing further to do */ }
        try {
            if ((child === null || child === void 0 ? void 0 : child.stdin) && !child.stdin.destroyed) {
                child.stdin.end();
            }
        }
        catch (e) { /* already gone */ }
        // SIGTERM is not enough for an ffmpeg blocked on an input that never delivers.
        // Three orphans were found alive on this deployment, one for 6.3 hours, each
        // still holding a prebuffer subscription. Escalate if it has not exited shortly.
        if (child) {
            const escalate = setTimeout(() => {
                try {
                    if (child.exitCode === null && child.signalCode === null) {
                        this.log.warn('HksvStreamer: ffmpeg ignored SIGTERM, sending SIGKILL');
                        child.kill('SIGKILL');
                    }
                }
                catch (e) { /* already gone */ }
            }, 3000);
            escalate.unref();
        }
        (_b = this.childProcess) === null || _b === void 0 ? void 0 : _b.kill();
        this.childProcess = undefined;
        this.destroyed = true;
        // Close the listening server if a client never connected (otherwise the socket leaks for the
        // life of the process), and resolve connectPromise so a generator still awaiting a connection
        // that will now never come unblocks (it then throws the "Unexpected state!" guard below).
        try {
            this.server.close(() => { });
        }
        catch (e) { /* not listening */ }
        (_c = this.connectResolve) === null || _c === void 0 ? void 0 : _c.call(this);
    }
    handleDisconnect() {
        var _a, _b;
        this.log.debug('Socket destroyed.');
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.destroy();
        this.socket = undefined;
        // If ffmpeg exits or errors before ever connecting (e.g. a bad input), connectPromise would
        // otherwise never settle and generator() would await it forever, hanging the recording and
        // leaking the server. Close it and resolve so the generator fails fast and visibly instead.
        try {
            this.server.close(() => { });
        }
        catch (e) { /* not listening */ }
        (_b = this.connectResolve) === null || _b === void 0 ? void 0 : _b.call(this);
    }
    handleConnection(socket) {
        var _a;
        this.server.close(); // don't accept any further clients
        this.socket = socket;
        (_a = this.connectResolve) === null || _a === void 0 ? void 0 : _a.call(this);
    }
    /**
     * Generator for `MP4Atom`s.
     * Throws error to signal EOF when socket is closed.
     */
    async *generator() {
        await this.connectPromise;
        if (!this.socket || !this.childProcess) {
            this.log.debug("Socket undefined " + !!this.socket + " childProcess undefined " + !!this.childProcess);
            throw new Error("Unexpected state!");
        }
        while (this.childProcess) {
            const header = await this.read(8);
            const length = header.readInt32BE(0) - 8;
            const type = header.slice(4).toString();
            const data = await this.read(length);
            yield {
                header: header,
                length: length,
                type: type,
                data: data,
            };
        }
    }
    async read(length) {
        if (!this.socket) {
            throw Error("FFMPEG tried reading from closed socket!");
        }
        if (!length) {
            return Buffer.alloc(0);
        }
        const value = this.socket.read(length);
        if (value) {
            return value;
        }
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                var _a, _b;
                (_a = this.socket) === null || _a === void 0 ? void 0 : _a.removeListener("readable", readHandler);
                (_b = this.socket) === null || _b === void 0 ? void 0 : _b.removeListener("close", endHandler);
            };
            const readHandler = () => {
                const value = this.socket.read(length);
                if (value) {
                    cleanup();
                    resolve(value);
                }
            };
            const endHandler = () => {
                cleanup();
                reject(new Error(`FFMPEG socket closed during read for ${length} bytes!`));
            };
            if (!this.socket) {
                throw new Error("FFMPEG socket is closed now!");
            }
            this.socket.on("readable", readHandler);
            this.socket.on("close", endHandler);
        });
    }
}
exports.default = HksvStreamer;
//# sourceMappingURL=HksvStreamer.js.map