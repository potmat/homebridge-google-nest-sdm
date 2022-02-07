"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const child_process_1 = require("child_process");
const net_1 = require("net");
class MP4StreamingServer {
    constructor(ffmpegPath, ffmpegInput, audioOutputArgs, videoOutputArgs) {
        /**
         * This can be configured to output ffmpeg debug output!
         */
        this.debugMode = false;
        this.destroyed = false;
        this.connectPromise = new Promise(resolve => this.connectResolve = resolve);
        this.server = (0, net_1.createServer)(this.handleConnection.bind(this));
        this.ffmpegPath = ffmpegPath;
        this.args = [];
        this.args.push(...ffmpegInput);
        this.args.push(...audioOutputArgs);
        this.args.push("-f", "mp4");
        this.args.push(...videoOutputArgs);
        this.args.push("-fflags", "+genpts", "-reset_timestamps", "1");
        this.args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof");
    }
    async start() {
        var _a, _b;
        const promise = (0, events_1.once)(this.server, "listening");
        this.server.listen(); // listen on random port
        await promise;
        if (this.destroyed) {
            return;
        }
        const port = this.server.address().port;
        this.args.push("tcp://127.0.0.1:" + port);
        console.log(this.ffmpegPath + " " + this.args.join(" "));
        this.childProcess = (0, child_process_1.spawn)(this.ffmpegPath, this.args, { env: process.env, stdio: this.debugMode ? "pipe" : "ignore" });
        if (!this.childProcess) {
            console.error("ChildProcess is undefined directly after the init!");
        }
        if (this.debugMode) {
            (_a = this.childProcess.stdout) === null || _a === void 0 ? void 0 : _a.on("data", data => console.log(data.toString()));
            (_b = this.childProcess.stderr) === null || _b === void 0 ? void 0 : _b.on("data", data => console.log(data.toString()));
        }
    }
    destroy() {
        var _a, _b;
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.destroy();
        (_b = this.childProcess) === null || _b === void 0 ? void 0 : _b.kill();
        this.socket = undefined;
        this.childProcess = undefined;
        this.destroyed = true;
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
            console.log("Socket undefined " + !!this.socket + " childProcess undefined " + !!this.childProcess);
            throw new Error("Unexpected state!");
        }
        while (true) {
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
            const readHandler = () => {
                const value = this.socket.read(length);
                if (value) {
                    // eslint-disable-next-line @typescript-eslint/no-use-before-define
                    cleanup();
                    resolve(value);
                }
            };
            const endHandler = () => {
                // eslint-disable-next-line @typescript-eslint/no-use-before-define
                cleanup();
                reject(new Error(`FFMPEG socket closed during read for ${length} bytes!`));
            };
            const cleanup = () => {
                var _a, _b;
                (_a = this.socket) === null || _a === void 0 ? void 0 : _a.removeListener("readable", readHandler);
                (_b = this.socket) === null || _b === void 0 ? void 0 : _b.removeListener("close", endHandler);
            };
            if (!this.socket) {
                throw new Error("FFMPEG socket is closed now!");
            }
            this.socket.on("readable", readHandler);
            this.socket.on("close", endHandler);
        });
    }
}
exports.default = MP4StreamingServer;
//# sourceMappingURL=MP4StreamingServer.js.map