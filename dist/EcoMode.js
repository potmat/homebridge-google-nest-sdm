"use strict";
module.exports = (homebridge) => {
    var _a;
    return _a = class EcoMode extends homebridge.hap.Characteristic {
            constructor() {
                super('Eco', EcoMode.UUID, {
                    format: "bool" /* BOOL */,
                    perms: ["pw" /* PAIRED_WRITE */, "pr" /* PAIRED_READ */, "ev" /* NOTIFY */]
                });
                this.value = this.getDefaultValue();
            }
        },
        _a.UUID = 'f66de49d-792e-44a6-99c8-5e3576328ba1',
        _a;
};
//# sourceMappingURL=EcoMode.js.map