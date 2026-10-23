import { once } from "events";
import { ChildProcess, spawn } from "child_process";
import { AddressInfo, createServer, Server, Socket } from "net";
import {Logger} from "homebridge";
import {Readable} from "stream";
import {NestStream} from "./NestStreamer";

interface MP4Atom {
    header: Buffer;
    length: number;
    type: string;
    data: Buffer;
}

export default class HksvStreamer {
    readonly server: Server;
    readonly ffmpegPath: string;
    readonly args: string[];
    private nestStream: NestStream;
    private debugMode: boolean;
    private log: Logger;

    socket?: Socket;
    childProcess?: ChildProcess;
    destroyed = false;

    connectPromise: Promise<void>;
    connectResolve?: () => void;

    constructor(log: Logger, nestStream: NestStream, audioOutputArgs: Array<string>, videoOutputArgs: Array<string>, debugMode: boolean) {
        this.nestStream = nestStream;
        this.debugMode = debugMode;
        this.log = log;
        this.connectPromise = new Promise(resolve => this.connectResolve = resolve);

        this.server = createServer(this.handleConnection.bind(this));

        this.ffmpegPath = require('ffmpeg-for-homebridge');
        if (!this.ffmpegPath)
            this.ffmpegPath = 'ffmpeg';

        this.args = [];

        this.args.push(...nestStream.args.split(/ /g));

        this.args.push(...audioOutputArgs);

        this.args.push("-f", "mp4");
        this.args.push(...videoOutputArgs);
        this.args.push("-fflags",
            "+genpts",
            "-reset_timestamps",
            "1");
        this.args.push(
            "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        );
    }

    convertStringToStream(stringToConvert: string) {
        const stream = new Readable();
        stream._read = () => { };
        stream.push(stringToConvert);
        stream.push(null);
        return stream;
    }

    async start() {

        this.log.debug('HksvStreamer start command received.');

        const promise = once(this.server, "listening");
        this.server.listen(); // listen on random port
        await promise;

        if (this.destroyed) {
            // destroy() ran while we were awaiting 'listening'. Close the server we just
            // opened; returning without it leaves a listening socket for the life of the
            // process.
            try { this.server.close(() => { /* ignore "not running" */ }); } catch (e) { /* not listening */ }
            return;
        }

        const port = (this.server.address() as AddressInfo).port;
        this.args.push("tcp://127.0.0.1:" + port);

        this.log.debug(this.ffmpegPath + " " + this.args.join(" "));

        this.childProcess = spawn(this.ffmpegPath, this.args, { env: process.env, stdio: 'pipe' });

        this.childProcess.on('error', (error: Error) => {
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
            } else if (this.nestStream.stdinStream) {
                // Prebuffer path: a continuous fragmented-MP4 byte stream, not an SDP.
                const src = this.nestStream.stdinStream;

                // ffmpeg exiting first raises EPIPE on the writer; an unhandled 'error'
                // on stdin would take the whole Homebridge process down rather than end
                // one recording.
                this.childProcess.stdin.on('error', () => {
                    try { src.destroy(); } catch (e) { /* already gone */ }
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
                    } catch (e) { /* ffmpeg already gone */ }
                });

                src.pipe(this.childProcess.stdin);
            }
        }

        if(this.debugMode) {
            this.childProcess.stdout?.on("data", data => this.log.debug(data.toString()));
            this.childProcess.stderr?.on("data", data => this.log.debug(data.toString()));
        }
    }

    destroy() {
        this.log.debug('HksvStreamer destroy command received, ending process.');

        const child = this.childProcess;

        // Give ffmpeg EOF on stdin BEFORE signalling it, so it can flush and exit on its
        // own. Destroying the ring's Readable also drops this recording's subscription,
        // which is what stops a dead recording from holding the prebuffer open.
        try {
            this.nestStream.stdinStream?.destroy();
        } catch (e) { /* nothing further to do */ }
        try {
            if (child?.stdin && !child.stdin.destroyed) {
                child.stdin.end();
            }
        } catch (e) { /* already gone */ }

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
                } catch (e) { /* already gone */ }
            }, 3000);
            escalate.unref();
        }

        this.childProcess?.kill();
        this.childProcess = undefined;
        this.destroyed = true;
        // Close the listening server if a client never connected (otherwise the socket leaks for the
        // life of the process), and resolve connectPromise so a generator still awaiting a connection
        // that will now never come unblocks (it then throws the "Unexpected state!" guard below).
        try { this.server.close(() => { /* ignore "not running" */ }); } catch (e) { /* not listening */ }
        this.connectResolve?.();
    }

    handleDisconnect() {
        this.log.debug('Socket destroyed.')
        this.socket?.destroy();
        this.socket = undefined;
        // If ffmpeg exits or errors before ever connecting (e.g. a bad input), connectPromise would
        // otherwise never settle and generator() would await it forever, hanging the recording and
        // leaking the server. Close it and resolve so the generator fails fast and visibly instead.
        try { this.server.close(() => { /* ignore "not running" */ }); } catch (e) { /* not listening */ }
        this.connectResolve?.();
    }

    handleConnection(socket: Socket): void {
        this.server.close(); // don't accept any further clients
        this.socket = socket;
        this.connectResolve?.();
    }

    /**
     * Generator for `MP4Atom`s.
     * Throws error to signal EOF when socket is closed.
     */
    async* generator(): AsyncGenerator<MP4Atom> {

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

    async read(length: number): Promise<Buffer> {
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
                this.socket?.removeListener("readable", readHandler);
                this.socket?.removeListener("close", endHandler);
            };

            const readHandler = () => {
                const value = this.socket!.read(length);
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