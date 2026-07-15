import * as fs from 'fs';
import * as path from 'path';
import {Logger} from 'homebridge';

export interface CachedStreamParams {
    /** base64-encoded SPS NAL unit */
    sps: string;
    /** base64-encoded PPS NAL unit */
    pps: string;
}

/**
 * Persists per-camera H.264 parameter sets (SPS/PPS) so that, once a camera has
 * streamed at least once, we can prime FFmpeg with its sprop-parameter-sets up
 * front instead of probing them out of the live stream every time.
 *
 * Keyed by the camera's SDM device resource name (camera.getName()), which is
 * stable across restarts. Backed by a single JSON file in the Homebridge
 * storage directory so the learned values survive restarts and updates.
 */
export class StreamParamCache {
    private readonly filePath: string;
    private readonly log: Logger;
    private cache: Record<string, CachedStreamParams> = {};

    constructor(storagePath: string, log: Logger) {
        this.log = log;
        this.filePath = path.join(storagePath, 'homebridge-google-nest-sdm-stream-params.json');
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                this.cache = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                this.log.debug(`Loaded cached stream parameters for ${Object.keys(this.cache).length} camera(s).`);
            }
        } catch (error: any) {
            this.log.warn(`Could not read stream parameter cache at ${this.filePath}, starting fresh.`, error?.message ?? error);
            this.cache = {};
        }
    }

    private save(): void {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
        } catch (error: any) {
            this.log.warn(`Could not write stream parameter cache at ${this.filePath}.`, error?.message ?? error);
        }
    }

    get(deviceId: string): CachedStreamParams | undefined {
        return this.cache[deviceId];
    }

    /**
     * Store the parameter sets for a camera. No-op (and no disk write) if the
     * values are unchanged, so this is cheap to call on every captured keyframe.
     * If they differ — e.g. the camera changed resolution or firmware — the new
     * values overwrite the old ones, so the cache self-heals on the next stream.
     */
    set(deviceId: string, params: CachedStreamParams): void {
        const existing = this.cache[deviceId];
        if (existing && existing.sps === params.sps && existing.pps === params.pps)
            return;

        this.cache[deviceId] = params;
        this.save();
        this.log.debug(`Updated cached stream parameters for ${deviceId}.`);
    }
}
