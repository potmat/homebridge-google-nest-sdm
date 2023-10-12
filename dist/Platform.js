"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Platform = void 0;
const Settings_1 = require("./Settings");
const CameraAccessory_1 = require("./CameraAccessory");
const Api_1 = require("./sdm/Api");
const ThermostatAccessory_1 = require("./ThermostatAccessory");
const Camera_1 = require("./sdm/Camera");
const Thermostat_1 = require("./sdm/Thermostat");
const Doorbell_1 = require("./sdm/Doorbell");
const DoorbellAccessory_1 = require("./DoorbellAccessory");
const EcoMode = require("./EcoMode");
const FanAccessory_1 = require("./FanAccessory");
const UnknownDevice_1 = require("./sdm/UnknownDevice");
let IEcoMode;
/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
class Platform {
    constructor(log, platformConfig, api) {
        this.log = log;
        this.platformConfig = platformConfig;
        this.api = api;
        this.accessories = [];
        this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
        this.EcoMode = EcoMode(api);
        IEcoMode = this.EcoMode;
        this.config = platformConfig;
        if (!this.config || !this.config.projectId || !this.config.clientId || !this.config.clientSecret || !this.config.refreshToken || !this.config.subscriptionId) {
            log.error(`${platformConfig.platform} is not configured correctly. The configuration provided was: ${JSON.stringify(this.config)}`);
            return;
        }
        this.smartDeviceManagement = new Api_1.SmartDeviceManagement(this.config, log);
        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            // run the method to discover / register your devices as accessories
            this.discoverDevices();
        });
        this.Characteristic = Object.defineProperty(this.api.hap.Characteristic, 'EcoMode', { value: this.EcoMode });
    }
    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }
    /**
     * This is an example method showing how to register discovered accessories.
     * Accessories must only be registered once, previously created accessories
     * must not be registered again to prevent "duplicate UUID" errors.
     */
    async discoverDevices() {
        if (!this.smartDeviceManagement)
            return;
        const devices = await this.smartDeviceManagement.list_devices();
        if (!devices)
            return;
        const deviceInfos = devices
            .map(device => {
            const uuid = this.api.hap.uuid.generate(device.getName());
            const category = (() => {
                if (device instanceof Doorbell_1.Doorbell)
                    return 18 /* VIDEO_DOORBELL */;
                else if (device instanceof Camera_1.Camera)
                    return 17 /* CAMERA */;
                else if (device instanceof Thermostat_1.Thermostat)
                    return 9 /* THERMOSTAT */;
                else if (device instanceof UnknownDevice_1.UnknownDevice)
                    return 1 /* OTHER */;
            })();
            return {
                device: device,
                uuid: uuid,
                category: category,
                existingAccessory: this.accessories.find(accessory => accessory.UUID === uuid)
            };
        });
        devices.filter(device => device instanceof Thermostat_1.Thermostat).forEach(thermostatDevice => {
            if (this.config.showFan) {
                const uuid = this.api.hap.uuid.generate(thermostatDevice.getName() + ' Fan');
                deviceInfos.push({
                    device: thermostatDevice,
                    uuid: uuid,
                    category: 3 /* FAN */,
                    existingAccessory: this.accessories.find(accessory => accessory.UUID === uuid)
                });
            }
        });
        // loop over the discovered devices and register each one if it has not already been registered
        for (const deviceInfo of deviceInfos) {
            if (deviceInfo.category === 1 /* OTHER */)
                continue;
            if (deviceInfo.existingAccessory) {
                this.log.info('Restoring existing accessory from cache:', deviceInfo.existingAccessory.displayName);
                // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
                deviceInfo.existingAccessory.context.device = deviceInfo.device;
                this.api.updatePlatformAccessories([deviceInfo.existingAccessory]);
                switch (deviceInfo.category) {
                    case 18 /* VIDEO_DOORBELL */:
                        new DoorbellAccessory_1.DoorbellAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device);
                        break;
                    case 17 /* CAMERA */:
                        new CameraAccessory_1.CameraAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device);
                        break;
                    case 9 /* THERMOSTAT */:
                        new ThermostatAccessory_1.ThermostatAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device);
                        break;
                    case 3 /* FAN */:
                        new FanAccessory_1.FanAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device);
                        break;
                }
                // update accessory cache with any changes to the accessory details and information
                this.api.updatePlatformAccessories([deviceInfo.existingAccessory]);
            }
            else {
                switch (deviceInfo.category) {
                    case 18 /* VIDEO_DOORBELL */:
                        const doorbellPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, 18 /* VIDEO_DOORBELL */);
                        new DoorbellAccessory_1.DoorbellAccessory(this.api, this.log, this, doorbellPlatformAccessory, deviceInfo.device);
                        this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [doorbellPlatformAccessory]);
                        break;
                    case 17 /* CAMERA */:
                        const cameraPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, 17 /* CAMERA */);
                        new CameraAccessory_1.CameraAccessory(this.api, this.log, this, cameraPlatformAccessory, deviceInfo.device);
                        this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [cameraPlatformAccessory]);
                        break;
                    case 9 /* THERMOSTAT */:
                        let thermostatPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, 9 /* THERMOSTAT */);
                        new ThermostatAccessory_1.ThermostatAccessory(this.api, this.log, this, thermostatPlatformAccessory, deviceInfo.device);
                        this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [thermostatPlatformAccessory]);
                        break;
                    case 3 /* FAN */:
                        let fanPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName() + ' Fan', deviceInfo.uuid, 3 /* FAN */);
                        new FanAccessory_1.FanAccessory(this.api, this.log, this, fanPlatformAccessory, deviceInfo.device);
                        this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [fanPlatformAccessory]);
                        break;
                }
            }
        }
    }
    getPlatformAccessory(device, name, uuid, category) {
        this.log.info('Adding new accessory:', name);
        const accessory = new this.api.platformAccessory(name || "Unknown Name", uuid, category);
        accessory.context.device = device;
        return accessory;
    }
}
exports.Platform = Platform;
//# sourceMappingURL=Platform.js.map