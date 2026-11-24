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
    probeSize?: number,
    // HKSV pre-trigger buffer. Opt-in: the feature is inert unless prebufferRtspBase
    // is set, because it needs a local RTSP restreamer (go2rtc, MediaMTX, ...) in
    // front of the cameras. See PrebufferManager for why it cannot read SDM directly.
    prebufferRtspBase?: string,
    prebufferSeconds?: number,
    prebufferRetainSeconds?: number,
    // Optional display-name -> restreamer stream-name overrides. Without an entry a
    // camera's stream name is its display name slugified ("Front Door" -> front_door).
    prebufferStreamNames?: Record<string, string>
}
