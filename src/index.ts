
import { API } from 'homebridge';

import { PLATFORM_NAME } from './Settings';
import { Platform } from './Platform';

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
    api.registerPlatform(PLATFORM_NAME, Platform);
};
