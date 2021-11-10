"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnknownDevice = void 0;
const Device_1 = require("./Device");
class UnknownDevice extends Device_1.Device {
    getDisplayName() {
        return 'Unknown';
    }
    event(event) {
    }
}
exports.UnknownDevice = UnknownDevice;
//# sourceMappingURL=UnknownDevice.js.map