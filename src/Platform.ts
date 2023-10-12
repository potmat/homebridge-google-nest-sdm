import {
    API,
    DynamicPlatformPlugin,
    Logger,
    PlatformAccessory,
    PlatformConfig,
    Characteristic,
    Categories
} from 'homebridge';

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
import {FanAccessory} from "./FanAccessory";
import {Device} from "./sdm/Device";
import {UnknownDevice} from "./sdm/UnknownDevice";

let IEcoMode: any;

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class Platform implements DynamicPlatformPlugin {
    public readonly Characteristic: typeof Characteristic & typeof IEcoMode;
    public readonly debugMode: boolean;
    private readonly smartDeviceManagement: SmartDeviceManagement | undefined;
    private readonly accessories: PlatformAccessory[] = [];
    private readonly EcoMode;
    private readonly config: Config;

    constructor(
        public readonly log: Logger,
        public readonly platformConfig: PlatformConfig,
        public readonly api: API,
    ) {
        this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');
        this.EcoMode = EcoMode(api);
        IEcoMode = this.EcoMode;

        this.config = platformConfig as unknown as Config;
        if (!this.config || !this.config.projectId || !this.config.clientId || !this.config.clientSecret || !this.config.refreshToken || !this.config.subscriptionId) {
            log.error(`${platformConfig.platform} is not configured correctly. The configuration provided was: ${JSON.stringify(this.config)}`)
            return;
        }

        this.smartDeviceManagement = new SmartDeviceManagement(this.config, log);
        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            // run the method to discover / register your devices as accessories
            this.discoverDevices();
        });

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

        const deviceInfos = devices
            .map(device => {
                const uuid = this.api.hap.uuid.generate(device.getName());
                const category = (() => {
                    if (device instanceof Doorbell)
                        return this.api.hap.Categories.VIDEO_DOORBELL;
                    else if (device instanceof Camera)
                        return this.api.hap.Categories.CAMERA;
                    else if (device instanceof Thermostat)
                        return this.api.hap.Categories.THERMOSTAT;
                    else if (device instanceof UnknownDevice)
                        return this.api.hap.Categories.OTHER;
                })();

                return {
                    device: device,
                    uuid: uuid,
                    category: category,
                    existingAccessory: this.accessories.find(accessory => accessory.UUID === uuid)
                }
            });

        devices.filter(device => device instanceof Thermostat).forEach(thermostatDevice => {
            if (this.config.showFan) {
                const uuid = this.api.hap.uuid.generate(thermostatDevice.getName() + ' Fan');
                deviceInfos.push({
                    device: thermostatDevice,
                    uuid: uuid,
                    category: this.api.hap.Categories.FAN,
                    existingAccessory: this.accessories.find(accessory => accessory.UUID === uuid)
                })
            }
        });

        // loop over the discovered devices and register each one if it has not already been registered
        for (const deviceInfo of deviceInfos) {

            if (deviceInfo.category === this.api.hap.Categories.OTHER)
                continue;

            if (deviceInfo.existingAccessory) {
                this.log.info('Restoring existing accessory from cache:', deviceInfo.existingAccessory.displayName);

                // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
                deviceInfo.existingAccessory.context.device = deviceInfo.device;
                this.api.updatePlatformAccessories([deviceInfo.existingAccessory]);

                switch (deviceInfo.category) {
                    case this.api.hap.Categories.VIDEO_DOORBELL:
                        new DoorbellAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device as Doorbell);
                        break;
                    case this.api.hap.Categories.CAMERA:
                        new CameraAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device as Camera);
                        break;
                    case this.api.hap.Categories.THERMOSTAT:
                        new ThermostatAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device as Thermostat);
                        break;
                    case this.api.hap.Categories.FAN:
                        new FanAccessory(this.api, this.log, this, deviceInfo.existingAccessory, deviceInfo.device as Thermostat);
                        break;
                }

                // update accessory cache with any changes to the accessory details and information
                this.api.updatePlatformAccessories([deviceInfo.existingAccessory]);
            } else {
                switch (deviceInfo.category) {
                    case this.api.hap.Categories.VIDEO_DOORBELL:
                        const doorbellPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, this.api.hap.Categories.VIDEO_DOORBELL);
                        new DoorbellAccessory(this.api, this.log, this, doorbellPlatformAccessory, deviceInfo.device as Doorbell);
                        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [doorbellPlatformAccessory]);
                        break;
                    case this.api.hap.Categories.CAMERA:
                        const cameraPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, this.api.hap.Categories.CAMERA);
                        new CameraAccessory(this.api, this.log, this, cameraPlatformAccessory, deviceInfo.device as Camera);
                        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cameraPlatformAccessory]);
                        break;
                    case this.api.hap.Categories.THERMOSTAT:
                        let thermostatPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName(), deviceInfo.uuid, this.api.hap.Categories.THERMOSTAT);
                        new ThermostatAccessory(this.api, this.log, this, thermostatPlatformAccessory, deviceInfo.device as Thermostat);
                        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [thermostatPlatformAccessory]);
                        break;
                    case this.api.hap.Categories.FAN:
                        let fanPlatformAccessory = this.getPlatformAccessory(deviceInfo.device, deviceInfo.device.getDisplayName() + ' Fan', deviceInfo.uuid, this.api.hap.Categories.FAN);
                        new FanAccessory(this.api, this.log, this, fanPlatformAccessory, deviceInfo.device as Thermostat);
                        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [fanPlatformAccessory]);
                        break;
                }
            }
        }
    }

    private getPlatformAccessory(device: Device, name: string, uuid: string, category: Categories) {
        this.log.info('Adding new accessory:', name);
        const accessory = new this.api.platformAccessory(name || "Unknown Name", uuid, category);
        accessory.context.device = device;
        return accessory;
    }
}
