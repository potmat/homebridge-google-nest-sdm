import {
    API,
    CharacteristicValue,
    Logger,
    Nullable,
    PlatformAccessory,
    PlatformAccessoryEvent,
    Service
} from 'homebridge';
import _ from "lodash";
import * as Traits from './sdm/Traits';
import {EcoModeType, TemperatureScale, ThermostatModeType} from './sdm/Traits';
import {Platform} from './Platform';
import {Thermostat} from "./sdm/Thermostat";
import {Accessory} from "./Accessory";
import {TemperatureRange} from "./sdm/Types";

export class ThermostatAccessory extends Accessory<Thermostat> {
    private readonly service: Service;

    constructor(
        api: API,
        log: Logger,
        platform: Platform,
        accessory: PlatformAccessory,
        device: Thermostat) {
        super(api, log, platform, accessory, device);

        this.accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
            log.info("%s identified!", accessory.displayName);
        });

        // create a new Thermostat service
        this.service = <Service>accessory.getService(this.api.hap.Service.Thermostat);
        if (!this.service) {
            this.service = accessory.addService(this.api.hap.Service.Thermostat);
        }

        let ecoModeSwitchService = accessory.getService('Eco Mode');
        let ecoModeCharacteristic = this.service.getCharacteristic(this.platform.Characteristic.EcoMode);
        if (platform.options.isEcoSwitchEnabled) {
            ecoModeCharacteristic && this.service.removeCharacteristic(ecoModeCharacteristic);

            ecoModeSwitchService ||= this.accessory.addService(this.api.hap.Service.Switch, 'Eco Mode', 'eco_mode_switch')
                .setCharacteristic(this.platform.Characteristic.Name, 'Eco Mode');

            ecoModeSwitchService.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handleEcoModeGet.bind(this))
                .onSet(this.handleEcoModeSet.bind(this));
        } else {
            // Clean up the switch if it was previously enabled
            ecoModeSwitchService && accessory.removeService(ecoModeSwitchService);

            ecoModeCharacteristic ||= this.service.addCharacteristic(this.platform.Characteristic.EcoMode);
            ecoModeCharacteristic
                .onGet(this.handleEcoModeGet.bind(this))
                .onSet(this.handleEcoModeSet.bind(this));
        }


        this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
            .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
            .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTemperatureGet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onGet(this.handleTemperatureDisplayUnitsGet.bind(this));

        this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
            .onGet(this.handleCurrentRelativeHumidityGet.bind(this));

        this.setupEvents();

        this.device.onTemperatureChanged = this.handleCurrentTemperatureUpdate.bind(this);
        this.device.onTemperatureUnitsChanged = this.handleTemperatureScaleUpdate.bind(this);
        this.device.onTargetTemperatureChanged = this.handleTargetTemperatureUpdate.bind(this);
        this.device.onTargetTemperatureRangeChanged = this.handleTargetTemperatureRangeUpdate.bind(this);
        this.device.onHumidityChanged = this.handleCurrentRelativeHumidityUpdate.bind(this);
        this.device.onHvacChanged = this.handleCurrentHeatingCoolingStateUpdate.bind(this);
        this.device.onModeChanged = this.handleTargetHeatingCoolingStateUpdate.bind(this);
        this.device.onEcoChanged = this.handleEcoUpdate.bind(this);
    }

    private async setupEvents() {
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).removeOnSet();
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).removeOnSet();
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).removeOnSet();

        let tempUnits = await this.device.getTemperatureUnits();

        let tempStep, minSetTemp, maxSetTemp, minGetTemp, maxGetTemp;
        if (tempUnits == TemperatureScale.FAHRENHEIT) {
            tempStep = 1;
            minSetTemp = this.fahrenheitToCelsius(50);
            maxSetTemp = this.fahrenheitToCelsius(90);
            minGetTemp = this.fahrenheitToCelsius(0);
            maxGetTemp = this.fahrenheitToCelsius(160);
        } else {
            tempStep = 0.5;
            minSetTemp = 9;
            maxSetTemp = 32;
            minGetTemp = -20;
            maxGetTemp = 60;
        }

        if ((await this.device.getEco())?.mode !== EcoModeType.OFF) {

            if (tempUnits == TemperatureScale.FAHRENHEIT) {
                minSetTemp = this.fahrenheitToCelsius(40);
            } else {
                minSetTemp = 4.5;
            }

            this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
                .onGet(this.handleCoolingThresholdTemperatureGet.bind(this));

            this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
                .onGet(this.handleHeatingThresholdTemperatureGet.bind(this));

            this.setCharactersticProps(tempStep, minGetTemp, maxGetTemp, minSetTemp, maxSetTemp);

            this.log.debug('Events reset.', this.accessory.displayName);
            return;
        }

        const targetMode = await this.device.getMode();

        this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .setProps({
                validValues: _.map(targetMode?.availableModes, (availableMode) => <number>this.convertThermostatModeType(availableMode))
            });

        switch (targetMode?.mode) {
            case ThermostatModeType.HEATCOOL:
                this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
                    .onGet(this.handleCoolingThresholdTemperatureGet.bind(this))
                    .onSet(this.handleCoolingThresholdTemperatureSet.bind(this));

                this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
                    .onGet(this.handleHeatingThresholdTemperatureGet.bind(this))
                    .onSet(this.handleHeatingThresholdTemperatureSet.bind(this));
                break;
            case ThermostatModeType.HEAT:
            case ThermostatModeType.COOL:
                this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
                    .onGet(this.handleHeatingThresholdTemperatureGet.bind(this));
                this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
                    .onGet(this.handleCoolingThresholdTemperatureGet.bind(this));
                this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
                    .onGet(this.handleTargetTemperatureGet.bind(this))
                    .onSet(this.handleTargetTemperatureSet.bind(this));
                break;
        }

        this.setCharactersticProps(tempStep, minGetTemp, maxGetTemp, minSetTemp, maxSetTemp);
        this.log.debug('Events reset.', this.accessory.displayName);
    }

    private setCharactersticProps(tempStep: number, minGetTemp: number, maxGetTemp: number, minSetTemp: number, maxSetTemp: number) {
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
            minStep: tempStep,
            minValue: minGetTemp,
            maxValue: maxGetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
            minStep: tempStep,
            minValue: minSetTemp,
            maxValue: maxSetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).setProps({
            minStep: tempStep,
            minValue: minSetTemp,
            maxValue: maxSetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).setProps({
            minStep: tempStep,
            minValue: minSetTemp,
            maxValue: maxSetTemp
        });
    }

    private fahrenheitToCelsius(temperature: number): number {
        return (temperature - 32) / 1.8;
    };

    private handleCurrentTemperatureUpdate(temperature: number) {
        this.log.debug('Update CurrentTemperature:' + temperature, this.accessory.displayName);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temperature);
    }

    private convertTemperatureDisplayUnits(unit: Traits.TemperatureScale | undefined): Nullable<CharacteristicValue> {
        switch (unit) {
            case TemperatureScale.CELSIUS:
                return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
            case TemperatureScale.FAHRENHEIT:
                return this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
            default:
                return null;
        }
    }

    private handleTemperatureScaleUpdate(unit: Traits.TemperatureScale) {
        this.log.debug('Update TemperatureUnits:' + unit, this.accessory.displayName);
        let converted = this.convertTemperatureDisplayUnits(unit);
        if (converted !== null)
            this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, converted);
    }

    private handleTargetTemperatureUpdate(temperature: number) {
        this.log.debug('Update TargetTemperature:' + temperature, this.accessory.displayName);
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temperature);
    }

    private handleTargetTemperatureRangeUpdate(range: TemperatureRange) {
        this.log.debug('Update TargetTemperatureRange:' + range, this.accessory.displayName);
        if (range.heat)
            this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, range.heat);
        if (range.cool)
            this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, range.cool);
    }

    private handleCurrentRelativeHumidityUpdate(humidity: number) {
        this.log.debug('Update CurrentRelativeHumidity:' + humidity, this.accessory.displayName);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
    }

    private handleCurrentHeatingCoolingStateUpdate(status: Traits.HvacStatusType) {
        this.log.debug('Update CurrentHeatingCoolingState:' + status, this.accessory.displayName);
        let converted = this.convertHvacStatusType(status);
        if (converted !== null)
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, converted);
    }

    private handleTargetHeatingCoolingStateUpdate(status: Traits.ThermostatModeType) {
        this.log.debug(`Update TargetHeatingCoolingState:${status}`, this.accessory.displayName);
        this.setupEvents();
        let converted = this.convertThermostatModeType(status);
        if (converted !== null)
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, converted);
    }

    private handleEcoUpdate(mode: Traits.ThermostatEco) {
        this.log.debug(`Update EcoMode: ${mode.mode}`, this.accessory.displayName);
        this.setupEvents();
        if (mode.mode === Traits.EcoModeType.MANUAL_ECO) {
            this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, mode.heatCelsius);
            this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, mode.coolCelsius);
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.platform.Characteristic.TargetHeatingCoolingState.OFF);
        }

        this.service.getCharacteristic(this.platform.Characteristic.EcoMode)?.updateValue(mode.mode === Traits.EcoModeType.MANUAL_ECO);
        this.accessory.getService('Eco Mode')?.updateCharacteristic(this.platform.Characteristic.On, mode.mode === Traits.EcoModeType.MANUAL_ECO)
    }

    /**
     * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
     */
    private async handleCurrentHeatingCoolingStateGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET CurrentHeatingCoolingState', this.accessory.displayName);
        let hvac = await this.device.getHvac();
        return this.convertHvacStatusType(hvac?.status);
    }

    private convertHvacStatusType(mode: Traits.HvacStatusType | undefined): Nullable<CharacteristicValue> {
        switch (mode) {
            case Traits.HvacStatusType.HEATING:
                return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
            case Traits.HvacStatusType.COOLING:
                return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
            case Traits.HvacStatusType.OFF:
                return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
            default:
                return null;
        }
    }

    /**
     * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
     */
    private async handleTargetHeatingCoolingStateGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET TargetHeatingCoolingState', this.accessory.displayName);

        if ((await this.device.getEco())?.mode !== EcoModeType.OFF)
            return this.platform.Characteristic.TargetHeatingCoolingState.OFF;

        let mode = await this.device.getMode();
        return this.convertThermostatModeType(mode?.mode);
    }

    private convertThermostatModeType(mode: Traits.ThermostatModeType | undefined): Nullable<CharacteristicValue> {
        switch (mode) {
            case Traits.ThermostatModeType.HEAT:
                return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
            case Traits.ThermostatModeType.COOL:
                return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
            case Traits.ThermostatModeType.HEATCOOL:
                return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
            case Traits.ThermostatModeType.OFF:
                return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
            default:
                return null;
        }
    }

    /**
     * Handle requests to set the "Target Heating Cooling State" characteristic
     */
    private async handleTargetHeatingCoolingStateSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET TargetHeatingCoolingState:' + value, this.accessory.displayName);

        let mode = Traits.ThermostatModeType.OFF;
        switch (value) {
            case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
                mode = Traits.ThermostatModeType.HEAT;
                break;
            case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
                mode = Traits.ThermostatModeType.COOL;
                break;
            case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
                mode = Traits.ThermostatModeType.HEATCOOL;
                break;
        }

        await this.device.setMode(mode);
    }

    /**
     * Handle requests to get the current value of the "Current Temperature" characteristic
     */
    private async handleCurrentTemperatureGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET CurrentTemperature', this.accessory.displayName);
        return await this.convertToNullable(this.device.getTemperature());
    }

    /**
     * Handle requests to get the current value of the "Current Relative Humidity" characteristic
     */
    private async handleCurrentRelativeHumidityGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET CurrentTemperature', this.accessory.displayName);
        return await this.convertToNullable(this.device.getRelativeHumitity());
    }


    /**
     * Handle requests to get the current value of the "Target Temperature" characteristic
     */
    private async handleTargetTemperatureGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET TargetTemperature', this.accessory.displayName);
        return await this.convertToNullable(this.device.getTargetTemperature());
    }

    /**
     * Handle requests to set the "Target Temperature" characteristic
     */
    private async handleTargetTemperatureSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET TargetTemperature:' + value, this.accessory.displayName);

        if (!_.isNumber(value))
            throw new Error(`Cannot set "${value}" as temperature.`);

        await this.device.setTargetTemperature(value);
    }

    /**
     * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
     */
    private async handleCoolingThresholdTemperatureGet(): Promise<CharacteristicValue> {
        this.log.debug('Triggered GET CoolingThresholdTemperature', this.accessory.displayName);

        const targetTemperatureRange = await this.device.getTargetTemperatureRange();
        const mode = await this.device.getMode();

        switch (mode?.mode) {
            case ThermostatModeType.COOL:
            case ThermostatModeType.HEATCOOL:
                return targetTemperatureRange?.cool!;
            case ThermostatModeType.HEAT:
                return targetTemperatureRange?.heat! - 0.5;
            default:
                throw new Error('Cannot get "Cooling Threshold Temperature" when thermostat is off.')
        }
    }

    /**
     * Handle requests to set the "Cooling Threshold Temperature" characteristic
     */
    private async handleCoolingThresholdTemperatureSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET CoolingThresholdTemperature:' + value, this.accessory.displayName);

        if (!_.isNumber(value))
            throw new Error(`Cannot set "${value}" as cooling threshold temperature.`);

        await this.device.setTargetTemperatureRange(value, undefined);
    }

    /**
     * Handle requests to get the current value of the "Heating Threshold Temperature" characteristic
     */
    private async handleHeatingThresholdTemperatureGet(): Promise<CharacteristicValue> {
        this.log.debug('Triggered GET HeatingThresholdTemperatureGet', this.accessory.displayName);

        const targetTemperatureRange = await this.device.getTargetTemperatureRange();
        const mode = await this.device.getMode();

        switch (mode?.mode) {
            case ThermostatModeType.HEAT:
            case ThermostatModeType.HEATCOOL:
                return targetTemperatureRange?.heat!;
            case ThermostatModeType.COOL:
                return targetTemperatureRange?.cool! + 0.5;
            default:
                throw new Error('Cannot get "Heating Threshold Temperature" when thermostat is off.')
        }
    }

    /**
     * Handle requests to set the "Heating Threshold Temperature" characteristic
     */
    private async handleHeatingThresholdTemperatureSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET HeatingThresholdTemperatureSet:' + value, this.accessory.displayName);

        if (!_.isNumber(value))
            throw new Error(`Cannot set "${value}" as heating threshold temperature.`);

        await this.device.setTargetTemperatureRange(undefined, value);
    }

    /**
     * Handle requests to get the current value of the "Temperature Display Units" characteristic
     */
    private async handleTemperatureDisplayUnitsGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET TemperatureDisplayUnits', this.accessory.displayName);
        return this.convertTemperatureDisplayUnits(await this.device.getTemperatureUnits());
    }

    /**
     * Handle requests to get the current value of the "Eco" characteristic
     */
    private async handleEcoModeGet(): Promise<CharacteristicValue> {
        this.log.debug('Triggered GET EcoMode', this.accessory.displayName);
        return await this.device.getEco().then(eco => eco?.mode === EcoModeType.MANUAL_ECO);
    }

    /**
     * Handle requests to set the "Eco" characteristic
     */
    private async handleEcoModeSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET EcoMode:' + value, this.accessory.displayName);
        await this.device.setEco(value ? EcoModeType.MANUAL_ECO : EcoModeType.OFF);
    }
}
