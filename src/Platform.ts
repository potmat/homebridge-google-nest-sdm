import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './Settings';
import { CameraAccessory } from './CameraAccessory';
import {SmartDeviceManagement} from './sdm/Api';
import {Config} from "./Config";
import {ThermostatAccessory} from "./ThermostatAccessory";
import {Camera} from "./sdm/Camera";
import {Thermostat} from "./sdm/Thermostat";
import {Doorbell} from "./sdm/Doorbell";
import {DoorbellAccessory} from "./DoorbellAccessory";
import EcoMode = require('./EcoMode');

let IEcoMode: any;

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class Platform implements DynamicPlatformPlugin {
    public readonly Characteristic: typeof Characteristic & typeof IEcoMode;
    private readonly smartDeviceManagement: SmartDeviceManagement | undefined;
    private readonly accessories: PlatformAccessory[] = [];
    private readonly EcoMode;

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.EcoMode = EcoMode(api);
        IEcoMode = this.EcoMode;

        const options = config as unknown as Config;

        if (!options || !options.projectId || !options.clientId || !options.clientSecret || !options.refreshToken || !options.subscriptionId) {
            log.error(`${config.platform} is not configured correctly. The configuration provided was: ${JSON.stringify(options)}`)
            return;
        }

        this.smartDeviceManagement = new SmartDeviceManagement(options, log);
        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            // run the method to discover / register your devices as accessories
            this.discoverDevices();
        });

        // Extends Characteristic for hap with custom AirPressureLevel.
        this.Characteristic = Object.defineProperty(this.api.hap.Characteristic, 'EcoMode', {value: this.EcoMode});
    }

    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory) {
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

                    if (device instanceof Doorbell)
                        new DoorbellAccessory(this.api, this.log, this, existingAccessory, device);
                    else if (device instanceof Camera)
                        new CameraAccessory(this.api, this.log, this, existingAccessory, device);
                    else if (device instanceof Thermostat)
                        new ThermostatAccessory(this.api, this.log, this, existingAccessory, device);

                    // update accessory cache with any changes to the accessory details and information
                    this.api.updatePlatformAccessories([existingAccessory]);
                } else if (!device) {
                    // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
                    // remove platform accessories when no longer present
                    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
                    this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
                }
            } else {
                // the accessory does not yet exist, so we need to create it
                this.log.info('Adding new accessory:', device.getDisplayName());

                let category;

                if (device instanceof Doorbell)
                    category = this.api.hap.Categories.VIDEO_DOORBELL;
                else if (device instanceof Camera)
                    category = this.api.hap.Categories.CAMERA;
                else if (device instanceof Thermostat)
                    category = this.api.hap.Categories.THERMOSTAT;

                // create a new accessory
                const accessory = new this.api.platformAccessory(device.getDisplayName() || "Unknown Name", uuid, category);
                // store a copy of the device object in the `accessory.context`
                // the `context` property can be used to store any data about the accessory you may need
                accessory.context.device = device;

                if (device instanceof Doorbell)
                    new DoorbellAccessory(this.api, this.log, this, accessory, device);
                else if (device instanceof Camera)
                    new CameraAccessory(this.api, this.log, this, accessory, device);
                else if (device instanceof Thermostat)
                    new ThermostatAccessory(this.api, this.log, this, accessory, device);


                // link the accessory to your platform
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
        }
    }
}
