"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotRefresher = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const NestStreamer_1 = require("./NestStreamer");
const MIN_INTERVAL_MINUTES = 5;
const FRAME_TIMEOUT_MS = 45000;
// The SDM API has no on-demand snapshot, so without this the Home app tile only
// ever shows the Nest/Google logo. When enabled, periodically open a short
// stream, decode a single frame to JPEG and keep it (in memory, and on disk so
// it survives restarts) for Camera.getSnapshot() to serve. Each refresh costs
// one GenerateWebRtcStream/GenerateRtspStream call, hence the minimum interval.
class SnapshotRefresher {
    constructor(log, camera, config, storagePath, isBusy, startDelayMs) {
        var _a;
        this.log = log;
        this.camera = camera;
        this.config = config;
        this.isBusy = isBusy;
        this.stopped = false;
        this.intervalMs = Math.max(MIN_INTERVAL_MINUTES, (_a = config.snapshotRefreshInterval) !== null && _a !== void 0 ? _a : 0) * 60 * 1000;
        const dir = path_1.default.join(storagePath, 'nest-snapshots');
        fs_1.default.mkdirSync(dir, { recursive: true });
        this.file = path_1.default.join(dir, camera.getDisplayName().replace(/[^a-zA-Z0-9]+/g, '_') + '.jpg');
        try {
            camera.setLastSnapshot(fs_1.default.readFileSync(this.file));
        }
        catch (e) {
            // no snapshot saved yet
        }
        this.timer = setTimeout(() => this.tick(), startDelayMs);
    }
    static isEnabled(config) {
        var _a;
        return ((_a = config.snapshotRefreshInterval) !== null && _a !== void 0 ? _a : 0) > 0;
    }
    stop() {
        this.stopped = true;
        if (this.timer)
            clearTimeout(this.timer);
    }
    async tick() {
        var _a;
        if (this.stopped)
            return;
        try {
            if (this.isBusy())
                this.log.debug('Snapshot refresh skipped, the camera is streaming.', this.camera.getDisplayName());
            else
                await this.refresh();
        }
        catch (error) {
            this.log.warn('Snapshot refresh failed: ' + ((_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error), this.camera.getDisplayName());
        }
        if (!this.stopped)
            this.timer = setTimeout(() => this.tick(), this.intervalMs);
    }
    async refresh() {
        const streamer = await (0, NestStreamer_1.getStreamer)(this.log, this.camera, this.config);
        try {
            const jpeg = await this.grabFrame(await streamer.initialize());
            this.camera.setLastSnapshot(jpeg);
            fs_1.default.promises.writeFile(this.file, jpeg)
                .catch(error => { var _a; return this.log.debug('Could not save snapshot.', (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error); });
            this.log.debug(`Snapshot refreshed (${jpeg.length} bytes).`, this.camera.getDisplayName());
        }
        finally {
            try {
                await streamer.teardown();
            }
            catch (error) {
                // teardown already logs its own errors
            }
        }
    }
    grabFrame(nestStream) {
        let pathToFfmpeg = require('ffmpeg-for-homebridge');
        if (!pathToFfmpeg)
            pathToFfmpeg = 'ffmpeg';
        const args = ['-hide_banner', '-loglevel', 'error', ...nestStream.args.split(/\s+/),
            '-an', '-sn', '-dn', '-frames:v', '1', '-vf', 'scale=min(1280\\,iw):-2',
            '-q:v', '4', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'];
        return new Promise((resolve, reject) => {
            var _a;
            const ffmpeg = (0, child_process_1.spawn)(pathToFfmpeg, args, { stdio: 'pipe' });
            const chunks = [];
            let stderr = '';
            const timeout = setTimeout(() => {
                ffmpeg.kill('SIGKILL');
                reject(new Error('timed out waiting for a frame'));
            }, FRAME_TIMEOUT_MS);
            ffmpeg.stdout.on('data', (data) => chunks.push(data));
            ffmpeg.stderr.on('data', (data) => stderr = (stderr + data.toString()).slice(-500));
            ffmpeg.stdin.on('error', () => undefined);
            ffmpeg.on('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
            ffmpeg.on('close', code => {
                clearTimeout(timeout);
                const jpeg = Buffer.concat(chunks);
                if (jpeg.length > 0)
                    resolve(jpeg);
                else
                    reject(new Error(`FFmpeg exited with code ${code} without a frame: ${stderr.trim()}`));
            });
            ffmpeg.stdin.end((_a = nestStream.stdin) !== null && _a !== void 0 ? _a : undefined);
        });
    }
}
exports.SnapshotRefresher = SnapshotRefresher;
//# sourceMappingURL=SnapshotRefresher.js.map