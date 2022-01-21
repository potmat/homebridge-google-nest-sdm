"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Display = void 0;
const Camera_1 = require("./Camera");
class Display extends Camera_1.Camera {
    getDisplayName() {
        return this.displayName ? this.displayName + ' Display' : 'Unknown';
    }
    getResolutions() {
        return [[1280, 720, 15], [1920, 1080, 15], [1600, 1200, 15]];
    }
}
exports.Display = Display;
//# sourceMappingURL=Display.js.map