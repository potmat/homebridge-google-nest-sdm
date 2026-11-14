/**
 * Where a thermostat's fan switch is exposed when `showFan` is enabled:
 * - `accessory`: a separate "<thermostat name> Fan" accessory (the default).
 * - `thermostat`: a Fan service on the thermostat's own accessory, so the Home app
 *   shows the switch inside the thermostat's controls.
 */
export type FanPlacement = 'accessory' | 'thermostat';

export type Config = {
    clientId: string,
    clientSecret: string,
    projectId: string,
    refreshToken: string,
    subscriptionId: string,
    gcpProjectId?: string,
    vEncoder?: string,
    showFan?: boolean,
    fanPlacement?: FanPlacement,
    fanDuration?: number,
    analyzeDuration?: number,
    probeSize?: number
}
