import {GoogleAuth, UserRefreshClient} from 'google-auth-library';
import {Config} from '../Config';

export function createPubSubAuth(config: Config): GoogleAuth<UserRefreshClient> {
    const authClient = new UserRefreshClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken
    });

    return new GoogleAuth({
        authClient,
        projectId: config.gcpProjectId || config.projectId
    });
}
