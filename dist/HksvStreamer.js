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
        }
        if (this.debugMode) {
            (_a = this.childProcess.stdout) === null || _a === void 0 ? void 0 : _a.on("data", data => this.log.debug(data.toString()));
            (_b = this.childProcess.stderr) === null || _b === void 0 ? void 0 : _b.on("data", data => this.log.debug(data.toString()));
        }
    }
    destroy() {
        var _a;
        this.log.debug('HksvStreamer destroy command received, ending process.');
        (_a = this.childProcess) === null || _a === void 0 ? void 0 : _a.kill();
        this.childProcess = undefined;
        this.destroyed = true;
    }
    handleDisconnect() {
        var _a;
        this.log.debug('Socket destroyed.');
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.destroy();
        this.socket = undefined;
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