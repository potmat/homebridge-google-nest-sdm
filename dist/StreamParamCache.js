"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamParamCache = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Persists per-camera H.264 parameter sets (SPS/PPS) so that, once a camera has
 * streamed at least once, we can prime FFmpeg with its sprop-parameter-sets up
 * front instead of probing them out of the live stream every time.
 *
 * Keyed by the camera's SDM device resource name (camera.getName()), which is
 * stable across restarts. Backed by a single JSON file in the Homebridge
 * storage directory so the learned values survive restarts and updates.
 */
class StreamParamCache {
    constructor(storagePath, log) {
        this.cache = {};
        this.log = log;
        this.filePath = path.join(storagePath, 'homebridge-google-nest-sdm-stream-params.json');
        this.load();
    }
    load() {
        var _a;
        try {
            if (fs.existsSync(this.filePath)) {
                this.cache = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                this.log.debug(`Loaded cached stream parameters for ${Object.keys(this.cache).length} camera(s).`);
            }
        }
        catch (error) {
            this.log.warn(`Could not read stream parameter cache at ${this.filePath}, starting fresh.`, (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error);
            this.cache = {};
        }
    }
    save() {
        var _a;
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
        }
        catch (error) {
            this.log.warn(`Could not write stream parameter cache at ${this.filePath}.`, (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error);
        }
    }
    get(deviceId) {
        return this.cache[deviceId];
    }
    /**
     * Store the parameter sets for a camera. No-op (and no disk write) if the
     * values are unchanged, so this is cheap to call on every captured keyframe.
     * If they differ — e.g. the camera changed resolution or firmware — the new
     * values overwrite the old ones, so the cache self-heals on the next stream.
     */
    set(deviceId, params) {
        const existing = this.cache[deviceId];
        if (existing && existing.sps === params.sps && existing.pps === params.pps)
            return;
        this.cache[deviceId] = params;
        this.save();
        this.log.debug(`Updated cached stream parameters for ${deviceId}.`);
    }
}
exports.StreamParamCache = StreamParamCache;
//# sourceMappingURL=StreamParamCache.js.map