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
exports.Doorbell = void 0;
const Camera_1 = require("./Camera");
const Events = __importStar(require("./Events"));
const lodash_1 = __importDefault(require("lodash"));
const Traits = __importStar(require("./Traits"));
const Events_1 = require("./Events");
class Doorbell extends Camera_1.Camera {
    getDisplayName() {
        return this.displayName ? this.displayName + ' Doorbell' : 'Unknown';
    }
    event(event) {
        super.event(event);
        lodash_1.default.forEach(event.resourceUpdate.events, (value, key) => {
            switch (key) {
                case Events.Constants.DoorbellChime:
                    const eventValue = value;
                    if (event.eventThreadState && event.eventThreadState != Events_1.ThreadStateType.STARTED)
                        return;
                    this.getVideoProtocol()
                        .then(protocol => {
                        if (protocol === Traits.ProtocolType.WEB_RTC) {
                            if (this.onRing)
                                this.onRing();
                        }
                        else {
                            this.getEventImage(eventValue.eventId, new Date(event.timestamp))
                                .then(() => {
                                if (this.onRing)
                                    this.onRing();
                            });
                        }
                    });
                    break;
            }
        });
    }
}
exports.Doorbell = Doorbell;
//# sourceMappingURL=Doorbell.js.map