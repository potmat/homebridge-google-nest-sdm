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
exports.ThreadStateType = exports.RelationUpdateType = exports.Constants = void 0;
const Traits = __importStar(require("./Traits"));
var Constants;
(function (Constants) {
    Constants["CameraMotion"] = "sdm.devices.events.CameraMotion.Motion";
    Constants["CameraPerson"] = "sdm.devices.events.CameraPerson.Person";
    Constants["CameraSound"] = "sdm.devices.events.CameraSound.Sound";
    Constants["DoorbellChime"] = "sdm.devices.events.DoorbellChime.Chime";
    Constants["ClipPreview"] = "sdm.devices.events.CameraClipPreview.ClipPreview";
})(Constants = exports.Constants || (exports.Constants = {}));
var RelationUpdateType;
(function (RelationUpdateType) {
    RelationUpdateType[RelationUpdateType["CREATED"] = 0] = "CREATED";
    RelationUpdateType[RelationUpdateType["UPDATED"] = 1] = "UPDATED";
    RelationUpdateType[RelationUpdateType["DELETED"] = 2] = "DELETED";
})(RelationUpdateType = exports.RelationUpdateType || (exports.RelationUpdateType = {}));
var ThreadStateType;
(function (ThreadStateType) {
    ThreadStateType["STARTED"] = "STARTED";
    ThreadStateType["UPDATED"] = "UPDATED";
    ThreadStateType["ENDED"] = "ENDED";
})(ThreadStateType = exports.ThreadStateType || (exports.ThreadStateType = {}));
//# sourceMappingURL=Events.js.map