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
    structureId?: string,
}
