import {spawn} from 'child_process';
import fs from 'fs';
import path from 'path';
import {Logger} from 'homebridge';
import {Config} from './Config';
import {Camera} from './sdm/Camera';
import {getStreamer, NestStream} from './NestStreamer';

const MIN_INTERVAL_MINUTES = 5;
const FRAME_TIMEOUT_MS = 45000;

// The SDM API has no on-demand snapshot, so without this the Home app tile only
// ever shows the Nest/Google logo. When enabled, periodically open a short
// stream, decode a single frame to JPEG and keep it (in memory, and on disk so
// it survives restarts) for Camera.getSnapshot() to serve. Each refresh costs
// one GenerateWebRtcStream/GenerateRtspStream call, hence the minimum interval.
export class SnapshotRefresher {
    private readonly intervalMs: number;
    private readonly file: string;
    private timer?: NodeJS.Timeout;
    private stopped = false;

    constructor(private readonly log: Logger,
                private readonly camera: Camera,
                private readonly config: Config,
                storagePath: string,
                private readonly isBusy: () => boolean,
                startDelayMs: number) {
        this.intervalMs = Math.max(MIN_INTERVAL_MINUTES, config.snapshotRefreshInterval ?? 0) * 60 * 1000;

        const dir = path.join(storagePath, 'nest-snapshots');
        fs.mkdirSync(dir, {recursive: true});
        this.file = path.join(dir, camera.getDisplayName().replace(/[^a-zA-Z0-9]+/g, '_') + '.jpg');
        try {
            camera.setLastSnapshot(fs.readFileSync(this.file));
        } catch (e) {
            // no snapshot saved yet
        }

        this.timer = setTimeout(() => this.tick(), startDelayMs);
    }

    static isEnabled(config: Config): boolean {
        return (config.snapshotRefreshInterval ?? 0) > 0;
    }

    stop(): void {
        this.stopped = true;
        if (this.timer)
            clearTimeout(this.timer);
    }

    private async tick(): Promise<void> {
        if (this.stopped)
            return;
        try {
            if (this.isBusy())
                this.log.debug('Snapshot refresh skipped, the camera is streaming.', this.camera.getDisplayName());
            else
                await this.refresh();
        } catch (error: any) {
            this.log.warn('Snapshot refresh failed: ' + (error?.message ?? error), this.camera.getDisplayName());
        }
        if (!this.stopped)
            this.timer = setTimeout(() => this.tick(), this.intervalMs);
    }

    private async refresh(): Promise<void> {
        const streamer = await getStreamer(this.log, this.camera, this.config);
        try {
            const jpeg = await this.grabFrame(await streamer.initialize());
            this.camera.setLastSnapshot(jpeg);
            fs.promises.writeFile(this.file, jpeg)
                .catch(error => this.log.debug('Could not save snapshot.', error?.message ?? error));
            this.log.debug(`Snapshot refreshed (${jpeg.length} bytes).`, this.camera.getDisplayName());
        } finally {
            try {
                await streamer.teardown();
            } catch (error) {
                // teardown already logs its own errors
            }
        }
    }

    private grabFrame(nestStream: NestStream): Promise<Buffer> {
        let pathToFfmpeg = require('ffmpeg-for-homebridge');
        if (!pathToFfmpeg)
            pathToFfmpeg = 'ffmpeg';

        const args = ['-hide_banner', '-loglevel', 'error', ...nestStream.args.split(/\s+/),
            '-an', '-sn', '-dn', '-frames:v', '1', '-vf', 'scale=min(1280\\,iw):-2',
            '-q:v', '4', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'];

        return new Promise((resolve, reject) => {
            const ffmpeg = spawn(pathToFfmpeg, args, {stdio: 'pipe'});
            const chunks: Buffer[] = [];
            let stderr = '';
            const timeout = setTimeout(() => {
                ffmpeg.kill('SIGKILL');
                reject(new Error('timed out waiting for a frame'));
            }, FRAME_TIMEOUT_MS);

            ffmpeg.stdout.on('data', (data: Buffer) => chunks.push(data));
            ffmpeg.stderr.on('data', (data: Buffer) => stderr = (stderr + data.toString()).slice(-500));
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
            ffmpeg.stdin.end(nestStream.stdin ?? undefined);
        });
    }
}
