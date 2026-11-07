import { ChildProcess, spawn } from 'child_process';
import { Readable, Writable } from 'stream';
import { CameraController, Logger, StreamRequestCallback } from 'homebridge';
import { StreamingDelegate } from './StreamingDelegate';
export class FfmpegProcess {
    private process: ChildProcess;
    private startupTimer: NodeJS.Timeout;
    private cancelStartup: () => void;
    constructor(cameraName: string, sessionId: string, ffmpegArgs: string, stdin: string | null | undefined, log: Logger, debug: boolean, delegate: StreamingDelegate<CameraController>, callback?: StreamRequestCallback) {
        let pathToFfmpeg = require('ffmpeg-for-homebridge');
        if (!pathToFfmpeg)
            pathToFfmpeg = 'ffmpeg';
        log.debug(`Stream command: ${pathToFfmpeg} ${ffmpegArgs} ${stdin}`, cameraName);
        let started = false;
        let callbackDone = false;
        let stopped = false;
        const finish = (error?: Error) => {
            if (callbackDone) return;
            callbackDone = true;
            clearTimeout(this.startupTimer);
            if (callback) callback(error);
        };
        const fail = (message: string) => {
            if (stopped) return;
            stopped = true;
            log.error(message, cameraName);
            finish(new Error(message));
            Promise.resolve(delegate.stopStream(sessionId)).catch(() => {});
            if (started) delegate.getController().forceStopStreamingSession(sessionId);
        };
        this.cancelStartup = () => {
            stopped = true;
            finish(new Error('Stream stopped before video became ready'));
        };
        this.startupTimer = setTimeout(() => fail('No encoded video within 15 seconds; stopping failed stream'), 15000);
        this.startupTimer.unref();
        // Diagnostics: millisecond-resolution timeline of FFmpeg's own startup
        // milestones, parsed from stderr (homebridge log timestamps only resolve
        // to the second). Read together with the [startup +Nms] RTP-arrival marks,
        // this shows whether time goes to packet arrival or to FFmpeg itself.
        const spawnTime = Date.now();
        const milestones = [
            { re: /Reinit context/, label: 'decoder has dimensions (Reinit)' },
            { re: /Input #0/, label: 'input probe complete (Input #0)' },
            { re: /Output #0/, label: 'output header written (Output #0)' },
            { re: /frame=/, label: 'first progress report (frame=)' },
        ];
        if (delegate.getCamera()?.snapshotCache) delegate.getCamera().snapshotCache!.buffers.set(sessionId, Buffer.alloc(0));
        this.process = spawn(pathToFfmpeg, ['-progress', 'pipe:1', '-nostats', ...ffmpegArgs.split(/\s+/)], { env: process.env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
        if (!this.process.stdin && stdin) {
            log.error('FFmpegProcess failed to start stream: input to ffmpeg was provided as stdin, but the process does not support stdin.', cameraName);
            delegate.stopStream(sessionId);
        }
        if (this.process.stdin) {
            this.process.stdin.on('error', (error) => {
                if (!error.message.includes('EPIPE')) {
                    log.error(error.message, cameraName);
                }
            });
            if (stdin) {
                const sdpStream = this.convertStringToStream(stdin);
                sdpStream.resume();
                sdpStream.pipe(this.process.stdin);
            }
        }
        if (this.process.stderr) {
            this.process.stderr.on('data', (data) => {
                const text = data.toString();
                for (let i = milestones.length - 1; i >= 0; i--) {
                    if (milestones[i].re.test(text)) {
                        log.debug(`[ffmpeg +${Date.now() - spawnTime}ms] ${milestones[i].label}`, cameraName);
                        milestones.splice(i, 1);
                    }
                }
                if (debug) {
                    text.split(/\n/).forEach((line: string) => {
                        if (!line.trim()) {
                            return;
                        }
                        // These are normal WebRTC bandwidth probes, not errors, and otherwise drown the log.
                        if (line.includes('Empty H.264 RTP packet')) {
                            return;
                        }
                        log.debug(line, cameraName);
                    });
                }
            });
        }
        if (this.process.stdio[3] && delegate.getCamera()?.consumeSnapshotData) {
            this.process.stdio[3].on('data', (data: Buffer) => delegate.getCamera().consumeSnapshotData(data, sessionId));
            this.process.once('exit', () => delegate.getCamera().endSnapshotData(sessionId));
        }
        // Machine-readable output reports real encoded frames, unlike the stderr banner.
        let progress = '';
        this.process.stdout!.on('data', (data) => {
            progress += data.toString();
            let newline;
            while ((newline = progress.indexOf('\n')) >= 0) {
                const line = progress.slice(0, newline).trim();
                progress = progress.slice(newline + 1);
                if (!started && !stopped && /^frame=\s*[1-9]\d*$/.test(line)) {
                    started = true;
                    log.info(`Live video ready after ${Date.now() - spawnTime}ms`, cameraName);
                    finish();
                }
            }
            if (progress.length > 4096) progress = '';
        });
        this.process.on('error', () => fail('FFmpeg process creation failed'));
        this.process.on('exit', (code, signal) => {
            clearTimeout(this.startupTimer);
            if (stopped || this.process.killed) return;
            fail('FFmpeg exited before stream was stopped (code ' + code + ', signal ' + signal + ')');
        });
    }
    stop(): Promise<void> {
        this.cancelStartup();
        if (this.process.exitCode != null || this.process.signalCode != null) return Promise.resolve();
        return new Promise<void>(resolve => {
            this.process.once('close', () => resolve());
            this.process.kill('SIGKILL');
        });
    }
    getStdin() {
        return this.process.stdin;
    }
    convertStringToStream(stringToConvert: string) {
        const stream = new Readable();
        stream._read = () => { };
        stream.push(stringToConvert);
        stream.push(null);
        return stream;
    }
}
