export type Config = {
    clientId: string,
    clientSecret: string,
    projectId: string,
    refreshToken: string,
    subscriptionId: string,
    gcpProjectId?: string,
    vEncoder?: string,
    disableAudio?: boolean,
    showFan?: boolean,
    fanDuration?: number
}
