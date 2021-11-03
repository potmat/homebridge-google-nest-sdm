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
/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
class Platform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        // this is used to track restored cached accessories
        this.accessories = [];
        this.smartDeviceManagement = new Api_1.SmartDeviceManagement(config.options, log);
        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            // run the method to discover / register your devices as accessories
            this.discoverDevices();
        });
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
        const devices = await this.smartDeviceManagement.list_devices();
        // loop over the discovered devices and register each one if it has not already been registered
        for (const device of devices) {
            // generate a unique id for the accessory this should be generated from
            // something globally unique, but constant, for example, the device serial
            // number or MAC address
            const uuid = this.api.hap.uuid.generate(device.getName());
            // see if an accessory with the same uuid has already been registered and restored from
            // the cached devices we stored in the `configureAccessory` method above
            const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
            if (existingAccessory) {
                // the accessory already exists
                if (device) {
                    this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
                    // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
                    existingAccessory.context.device = device;
                    this.api.updatePlatformAccessories([existingAccessory]);
                    if (device instanceof Doorbell_1.Doorbell)
                        new DoorbellAccessory_1.DoorbellAccessory(this.api, this.log, this, existingAccessory, device);
                    if (device instanceof Camera_1.Camera)
                        new CameraAccessory_1.CameraAccessory(this.api, this.log, this, existingAccessory, device);
                    else if (device instanceof Thermostat_1.Thermostat)
                        new ThermostatAccessory_1.ThermostatAccessory(this.api, this.log, this, existingAccessory, device);
                    // update accessory cache with any changes to the accessory details and information
                    this.api.updatePlatformAccessories([existingAccessory]);
                }
                else if (!device) {
                    // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
                    // remove platform accessories when no longer present
                    this.api.unregisterPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [existingAccessory]);
                    this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
                }
            }
            else {
                // the accessory does not yet exist, so we need to create it
                this.log.info('Adding new accessory:', device.displayName);
                let category;
                if (device instanceof Doorbell_1.Doorbell)
                    category = 18 /* VIDEO_DOORBELL */;
                else if (device instanceof Camera_1.Camera)
                    category = 17 /* CAMERA */;
                else if (device instanceof Thermostat_1.Thermostat)
                    category = 9 /* THERMOSTAT */;
                // create a new accessory
                const accessory = new this.api.platformAccessory(device.displayName || "Unknown Name", uuid, category);
                // store a copy of the device object in the `accessory.context`
                // the `context` property can be used to store any data about the accessory you may need
                accessory.context.device = device;
                if (device instanceof Doorbell_1.Doorbell)
                    new DoorbellAccessory_1.DoorbellAccessory(this.api, this.log, this, accessory, device);
                else if (device instanceof Camera_1.Camera)
                    new CameraAccessory_1.CameraAccessory(this.api, this.log, this, accessory, device);
                else if (device instanceof Thermostat_1.Thermostat)
                    new ThermostatAccessory_1.ThermostatAccessory(this.api, this.log, this, accessory, device);
                // link the accessory to your platform
                this.api.registerPlatformAccessories(Settings_1.PLUGIN_NAME, Settings_1.PLATFORM_NAME, [accessory]);
            }
        }
    }
}
exports.Platform = Platform;
//# sourceMappingURL=Platform.js.map