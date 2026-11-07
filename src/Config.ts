export type Config = {
    clientId: string,
    clientSecret: string,
    projectId: string,
    refreshToken: string,
    subscriptionId: string,
    gcpProjectId?: string,
    vEncoder?: string,
    showFan?: boolean,
    fanDuration?: number,
    analyzeDuration?: number,
    streamSnapshots?: boolean,
    streamStartupTimeout?: number,
    cameraProbeOverrides?: Record<string, {analyzeDuration?: number; probeSize?: number}>,
    probeSize?: number
}
