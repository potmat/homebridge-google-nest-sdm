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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Camera = void 0;
const Device_1 = require("./Device");
const Commands = __importStar(require("./Commands"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class Camera extends Device_1.Device {
    constructor() {
        super(...arguments);
        this.imageQueue = [];
    }
    async getSnapshot() {
        if (this.imageQueue.length > 0)
            return this.imageQueue.shift();
        //Nest cams do not have any method to get a current snapshot,
        //starting streams up just to retrieve one is slow and will cause
        //the SDM API to hit a rate limit of creating too many streams
        return await fs_1.default.promises.readFile(path_1.default.join(__dirname, "..", "res", "nest-logo.jpg"));
    }
    getResolutions() {
        return [[1280, 720, 15], [1920, 1080, 15]];
    }
    async getEventImage(eventId) {
        const generateResponse = await this.executeCommand(Commands.Constants.CameraEventImage_GenerateImage, {
            eventId: eventId
        });
        try {
            const imageResponse = await axios_1.default.get(generateResponse.url, {
                headers: {
                    'Authorization': 'Basic ' + generateResponse.token
                },
                responseType: 'arraybuffer'
            });
            const buffer = Buffer.from(imageResponse.data, 'binary');
            if (this.imageQueue.length > 5)
                this.imageQueue.shift();
            this.imageQueue.push(buffer);
        }
        catch (error) {
            this.log.error(error);
        }
    }
    async getStreamInfo() {
        return this.executeCommand(Commands.Constants.CameraLiveStream_GenerateRtspStream);
    }
    async stopStream(extensionToken) {
        return this.smartdevicemanagement.enterprises.devices.executeCommand({
            name: this.getName(),
            requestBody: {
                command: Commands.Constants.CameraLiveStream_StopRtspStream,
                params: {
                    streamExtensionToken: extensionToken
                }
            }
        }).then(response => {
            var _a, _b, _c;
            return (_c = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.results) === null || _b === void 0 ? void 0 : _b.streamUrls) === null || _c === void 0 ? void 0 : _c.rtspUrl;
        });
    }
    event(event) {
    }
}
exports.Camera = Camera;
//# sourceMappingURL=Camera.js.map