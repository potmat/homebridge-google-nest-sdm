import {API, Formats, Perms} from "homebridge";

export = (homebridge: API) => {
    return class EcoMode extends homebridge.hap.Characteristic {

        static readonly UUID: string = 'f66de49d-792e-44a6-99c8-5e3576328ba1';

        constructor() {
            super('Eco', EcoMode.UUID, {
                format: Formats.BOOL,
                perms: [Perms.PAIRED_WRITE, Perms.PAIRED_READ, Perms.NOTIFY]
            });
            this.value = this.getDefaultValue();
        }
    }
}
