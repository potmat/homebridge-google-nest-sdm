"use strict";
module.exports = (homebridge) => {
    var _a;
    return _a = class EcoMode extends homebridge.hap.Characteristic {
            constructor() {
                super('Eco', _a.UUID, {
                    format: "bool" /* Formats.BOOL */,
                    perms: ["pw" /* Perms.PAIRED_WRITE */, "pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */]
                });
                this.value = this.getDefaultValue();
            }
        },
        _a.UUID = 'f66de49d-792e-44a6-99c8-5e3576328ba1',
        _a;
};
//# sourceMappingURL=EcoMode.js.map