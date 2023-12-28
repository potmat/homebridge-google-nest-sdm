"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_ui_utils_1 = require("@homebridge/plugin-ui-utils");
/**
 * This class exposes endpoints that the custom UI can interact with.
 *
 * More info: https://github.com/homebridge/plugin-ui-utils/tree/latest?tab=readme-ov-file#server-api
 */
class PluginUiServer extends plugin_ui_utils_1.HomebridgePluginUiServer {
    constructor() {
        super();
        // register request handler
        this.onRequest('/refreshToken', this.handleRefreshToken.bind(this));
        // notify Homebridge we are ready to receive requests
        this.ready();
    }
    /**
     * `/refreshToken` request handler
     *
     * Exchanges an authorization code for a refresh token
     */
    async handleRefreshToken({ clientId, clientSecret, code }) {
        if (!clientId || !clientSecret || !code)
            throw new plugin_ui_utils_1.RequestError('Missing payload object', { status: 400 });
        try {
            const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v4/token?client_id=${clientId}&client_secret=${clientSecret}&code=${code}&grant_type=authorization_code&redirect_uri=https://www.google.com`, {
                method: 'POST'
            });
            const responseBody = await googleResponse.json();
            if (!googleResponse.ok) {
                throw new plugin_ui_utils_1.RequestError(`Error retrieving Google refresh token: ${responseBody['error_description']}`, { status: 500 });
            }
            return responseBody['refresh_token'];
        }
        catch (e) {
            if (e instanceof plugin_ui_utils_1.RequestError)
                throw e;
            else
                throw new plugin_ui_utils_1.RequestError(`Error retrieving Google refresh token: ${e.message}`, { status: 500 });
        }
    }
}
// instantiate plugin server
(() => new PluginUiServer())();
//# sourceMappingURL=server.js.map