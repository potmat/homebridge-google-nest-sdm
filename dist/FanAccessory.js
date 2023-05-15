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
exports.FanAccessory = void 0;
const Traits = __importStar(require("./sdm/Traits"));
const Traits_1 = require("./sdm/Traits");
const Accessory_1 = require("./Accessory");
const lodash_1 = __importDefault(require("lodash"));
class FanAccessory extends Accessory_1.Accessory {
    constructor(api, log, platform, accessory, device) {
        super(api, log, platform, accessory, device);
        this.config = platform.platformConfig;
        this.accessory.on("identify" /* IDENTIFY */, () => {
            log.info("%s fan identified!", accessory.displayName);
        });
        // create a new Thermostat service
        this.service = accessory.getService(this.api.hap.Service.Fan);
        if (!this.service) {
            this.service = accessory.addService(this.api.hap.Service.Fan);
        }
        this.service.getCharacteristic(this.platform.Characteristic.On)
            .onGet(this.handleOnGet.bind(this))
            .onSet(this.handleOnSet.bind(this));
        this.device.onFanChanged = this.handleFanUpdate.bind(this);
    }
    handleFanUpdate(fan) {
        this.log.debug('Update Fan:' + fan.timerMode, this.accessory.displayName);
        this.service.updateCharacteristic(this.platform.Characteristic.On, fan.timerMode === Traits_1.FanTimerModeType.ON);
    }
    /**
     * Handle requests to set the "On" characteristic
     */
    async handleOnSet(value) {
        this.log.debug('Triggered SET Fan', this.accessory.displayName);
        if (!lodash_1.default.isBoolean(value))
            throw new Error(`Cannot set "${value}" as fan state.`);
        if (this.config.fanDuration && (this.config.fanDuration < 1 || this.config.fanDuration > 43200))
            throw new Error(`Cannot set "${this.config.fanDuration}" as fan duration.`);
        await this.device.setFan(value ? Traits.FanTimerModeType.ON : Traits_1.FanTimerModeType.OFF, this.config.fanDuration);
    }
    /**
     * Handle requests to get the current value of the "On" characteristic
     */
    async handleOnGet() {
        this.log.debug('Triggered GET Fan On', this.accessory.displayName);
        const fan = await this.device.getFan();
        switch (fan === null || fan === void 0 ? void 0 : fan.timerMode) {
            case Traits_1.FanTimerModeType.ON:
                return true;
            default:
                return false;
        }
    }
}
exports.FanAccessory = FanAccessory;
//# sourceMappingURL=FanAccessory.js.map