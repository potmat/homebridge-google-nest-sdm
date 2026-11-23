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

        let ecoMode = this.service.getCharacteristic(this.platform.Characteristic.EcoMode);
        if (!ecoMode)
            ecoMode = this.service.addCharacteristic(this.platform.Characteristic.EcoMode);

        ecoMode
            .onGet(this.handleEcoModeGet.bind(this))
            .onSet(this.handleEcoModeSet.bind(this));

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

        this.device.onTemperatureChanged = this.handleCurrentTemperatureUpdate.bind(this);
        this.device.onTemperatureUnitsChanged = this.handleTemperatureScaleUpdate.bind(this);
        this.device.onTargetTemperatureChanged = this.handleTargetTemperatureUpdate.bind(this);
        this.device.onTargetTemperatureRangeChanged = this.handleTargetTemperatureRangeUpdate.bind(this);
        this.device.onHumidityChanged = this.handleCurrentRelativeHumidityUpdate.bind(this);
        this.device.onHvacChanged = this.handleCurrentHeatingCoolingStateUpdate.bind(this);
        this.device.onModeChanged = this.handleTargetHeatingCoolingStateUpdate.bind(this);
        this.device.onEcoChanged = this.handleEcoUpdate.bind(this);

        void this.initialize();
    }

    private async initialize() {
        await this.setupEvents();
        await this.syncCharacteristics();
    }

    private isEcoActive(eco: Traits.ThermostatEco | null | undefined): boolean {
        return eco?.mode !== undefined && eco.mode !== EcoModeType.OFF;
    }

    private async syncCharacteristics() {
        const [temp, humidity, hvac, mode, eco, units, targetTemp, range] = await Promise.all([
            this.device.getTemperature(),
            this.device.getRelativeHumitity(),
            this.device.getHvac(),
            this.device.getMode(),
            this.device.getEco(),
            this.device.getTemperatureUnits(),
            this.device.getTargetTemperature(),
            this.device.getTargetTemperatureRange()
        ]);

        if (temp !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temp);
        }
        if (humidity !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
        }
        const convertedHvac = this.convertHvacStatusType(hvac?.status);
        if (convertedHvac !== null) {
            this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, convertedHvac);
        }
        const convertedMode = this.convertThermostatModeType(mode?.mode);
        if (convertedMode !== null) {
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, convertedMode);
        }
        this.service.updateCharacteristic(this.platform.Characteristic.EcoMode, this.isEcoActive(eco));
        const convertedUnits = this.convertTemperatureDisplayUnits(units);
        if (convertedUnits !== null) {
            this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, convertedUnits);
        }
        if (targetTemp !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, targetTemp);
        }
        if (range?.heat !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, range.heat);
        }
        if (range?.cool !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, range.cool);
        }
    }

    private async setupEvents() {
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).removeOnSet();
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).removeOnSet();
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).removeOnGet();
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).removeOnSet();

        const tempUnits = await this.device.getTemperatureUnits();
        const ecoActive = this.isEcoActive(await this.device.getEco());

        let minSetTemp, maxSetTemp, minGetTemp, maxGetTemp;
        if (tempUnits == TemperatureScale.FAHRENHEIT) {
            minSetTemp = this.fahrenheitToCelsius(ecoActive ? 40 : 50);
            maxSetTemp = this.fahrenheitToCelsius(90);
            minGetTemp = this.fahrenheitToCelsius(0);
            maxGetTemp = this.fahrenheitToCelsius(160);
        } else {
            minSetTemp = ecoActive ? 4.5 : 9;
            maxSetTemp = 32;
            minGetTemp = -20;
            maxGetTemp = 60;
        }

        const targetMode = await this.device.getMode();

        if (targetMode?.availableModes?.length) {
            this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
                .setProps({
                    validValues: _.map(targetMode.availableModes, (availableMode) => <number>this.convertThermostatModeType(availableMode))
                });
        }

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

        this.setCharactersticProps(minGetTemp, maxGetTemp, minSetTemp, maxSetTemp);
        this.log.debug('Events reset.', this.accessory.displayName);
    }

    private setCharactersticProps(minGetTemp: number, maxGetTemp: number, minSetTemp: number, maxSetTemp: number) {
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
            minValue: minGetTemp,
            maxValue: maxGetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
            minValue: minSetTemp,
            maxValue: maxSetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).setProps({
            minValue: minSetTemp,
            maxValue: maxSetTemp
        });
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).setProps({
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

    private async syncTargetTemperatures() {
        const targetTemp = await this.device.getTargetTemperature();
        if (targetTemp !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, targetTemp);
        }
        const range = await this.device.getTargetTemperatureRange();
        if (range?.heat !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, range.heat);
        }
        if (range?.cool !== undefined) {
            this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, range.cool);
        }
    }

    private async handleTargetHeatingCoolingStateUpdate(status: Traits.ThermostatModeType) {
        this.log.debug(`Update TargetHeatingCoolingState:${status}`, this.accessory.displayName);
        await this.setupEvents();
        let converted = this.convertThermostatModeType(status);
        if (converted !== null)
            this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, converted);
        await this.syncTargetTemperatures();
    }

    private async handleEcoUpdate(mode: Traits.ThermostatEco) {
        this.log.debug(`Update EcoMode: ${mode.mode}`, this.accessory.displayName);
        await this.setupEvents();
        this.service.updateCharacteristic(this.platform.Characteristic.EcoMode, this.isEcoActive(mode));
        await this.syncTargetTemperatures();
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

    private async syncEcoAfterWrite(wasEcoActive: boolean, resetEvents = true) {
        if (!wasEcoActive) {
            return;
        }
        const ecoActive = this.isEcoActive(await this.device.getEco());
        if (!ecoActive) {
            this.service.updateCharacteristic(this.platform.Characteristic.EcoMode, false);
            if (resetEvents) {
                await this.setupEvents();
            }
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

        const wasEcoActive = this.isEcoActive(await this.device.getEco());
        await this.device.setMode(mode);
        await this.setupEvents();
        await this.syncEcoAfterWrite(wasEcoActive, false);
        await this.syncTargetTemperatures();
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

        const wasEcoActive = this.isEcoActive(await this.device.getEco());
        await this.device.setTargetTemperature(value);
        await this.syncEcoAfterWrite(wasEcoActive);
    }

    /**
     * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
     */
    private async handleCoolingThresholdTemperatureGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET CoolingThresholdTemperature', this.accessory.displayName);

        const targetTemperatureRange = await this.device.getTargetTemperatureRange();
        const mode = await this.device.getMode();

        switch (mode?.mode) {
            case ThermostatModeType.COOL:
            case ThermostatModeType.HEATCOOL:
                return targetTemperatureRange?.cool ?? null;
            case ThermostatModeType.HEAT:
                return targetTemperatureRange?.cool ?? targetTemperatureRange?.heat ?? null;
            default:
                return null;
        }
    }

    /**
     * Handle requests to set the "Cooling Threshold Temperature" characteristic
     */
    private async handleCoolingThresholdTemperatureSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET CoolingThresholdTemperature:' + value, this.accessory.displayName);

        if (!_.isNumber(value))
            throw new Error(`Cannot set "${value}" as cooling threshold temperature.`);

        const wasEcoActive = this.isEcoActive(await this.device.getEco());
        await this.device.setTargetTemperatureRange(value, undefined);
        await this.syncEcoAfterWrite(wasEcoActive);
    }

    /**
     * Handle requests to get the current value of the "Heating Threshold Temperature" characteristic
     */
    private async handleHeatingThresholdTemperatureGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET HeatingThresholdTemperatureGet', this.accessory.displayName);

        const targetTemperatureRange = await this.device.getTargetTemperatureRange();
        const mode = await this.device.getMode();

        switch (mode?.mode) {
            case ThermostatModeType.HEAT:
            case ThermostatModeType.HEATCOOL:
                return targetTemperatureRange?.heat ?? null;
            case ThermostatModeType.COOL:
                return targetTemperatureRange?.heat ?? targetTemperatureRange?.cool ?? null;
            default:
                return null;
        }
    }

    /**
     * Handle requests to set the "Heating Threshold Temperature" characteristic
     */
    private async handleHeatingThresholdTemperatureSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET HeatingThresholdTemperatureSet:' + value, this.accessory.displayName);

        if (!_.isNumber(value))
            throw new Error(`Cannot set "${value}" as heating threshold temperature.`);

        const wasEcoActive = this.isEcoActive(await this.device.getEco());
        await this.device.setTargetTemperatureRange(undefined, value);
        await this.syncEcoAfterWrite(wasEcoActive);
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
    private async handleEcoModeGet(): Promise<Nullable<CharacteristicValue>> {
        this.log.debug('Triggered GET EcoMode', this.accessory.displayName);
        return await this.convertToNullable(this.device.getEco().then(eco => eco?.mode === EcoModeType.MANUAL_ECO));
    }

    /**
     * Handle requests to set the "Eco" characteristic
     */
    private async handleEcoModeSet(value:CharacteristicValue) {
        this.log.debug('Triggered SET EcoMode:' + value, this.accessory.displayName);
        await this.device.setEco(value ? EcoModeType.MANUAL_ECO : EcoModeType.OFF);
        await this.setupEvents();
        await this.syncTargetTemperatures();
    }
}
