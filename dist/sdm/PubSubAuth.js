"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPubSubAuth = createPubSubAuth;
const google_auth_library_1 = require("google-auth-library");
function createPubSubAuth(config) {
    const authClient = new google_auth_library_1.UserRefreshClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken
    });
    return new google_auth_library_1.GoogleAuth({
        authClient,
        projectId: config.gcpProjectId || config.projectId
    });
}
//# sourceMappingURL=PubSubAuth.js.map