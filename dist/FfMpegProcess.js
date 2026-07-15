"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FfmpegProcess = void 0;
const child_process_1 = require("child_process");
const stream_1 = require("stream");
class FfmpegProcess {
    constructor(cameraName, sessionId, ffmpegArgs, stdin, log, debug, delegate, callback) {
        let pathToFfmpeg = require('ffmpeg-for-homebridge');
        if (!pathToFfmpeg)
            pathToFfmpeg = 'ffmpeg';
        log.debug(`Stream command: ${pathToFfmpeg} ${ffmpegArgs} ${stdin}`, cameraName);
        let started = false;
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
        this.process = (0, child_process_1.spawn)(pathToFfmpeg, ffmpegArgs.split(/\s+/), { env: process.env, stdio: 'pipe' });
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
                if (!started) {
                    started = true;
                    if (callback) {
                        callback();
                    }
                }
                const text = data.toString();
                for (let i = milestones.length - 1; i >= 0; i--) {
                    if (milestones[i].re.test(text)) {
                        log.debug(`[ffmpeg +${Date.now() - spawnTime}ms] ${milestones[i].label}`, cameraName);
                        milestones.splice(i, 1);
                    }
                }
                if (debug) {
                    text.split(/\n/).forEach((line) => {
                        log.debug(line, cameraName);
                    });
                }
            });
        }
        this.process.on('error', (error) => {
            log.error('Failed to start stream: ' + error.message, cameraName);
            if (callback) {
                callback(new Error('FFmpeg process creation failed'));
            }
            delegate.stopStream(sessionId);
        });
        this.process.on('exit', (code, signal) => {
            const message = 'FFmpeg exited with code: ' + code + ' and signal: ' + signal;
            if (code == null || code === 255) {
                if (this.process.killed) {
                    log.debug(message + ' (Expected)', cameraName);
                }
                else {
                    log.error(message + ' (Unexpected)', cameraName);
                }
            }
            else {
                log.error(message + ' (Error)', cameraName);
                delegate.stopStream(sessionId);
                if (!started && callback) {
                    callback(new Error(message));
                }
                else {
                    delegate.getController().forceStopStreamingSession(sessionId);
                }
            }
        });
    }
    stop() {
        this.process.kill('SIGKILL');
    }
    getStdin() {
        return this.process.stdin;
    }
    convertStringToStream(stringToConvert) {
        const stream = new stream_1.Readable();
        stream._read = () => { };
        stream.push(stringToConvert);
        stream.push(null);
        return stream;
    }
}
exports.FfmpegProcess = FfmpegProcess;
//# sourceMappingURL=FfMpegProcess.js.map