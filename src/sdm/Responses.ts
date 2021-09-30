export interface StreamUrls {
    rtspUrl: string;
}

export interface GenerateRtspStream {
    streamUrls: StreamUrls;
    streamExtensionToken: string;
    streamToken: string;
    expiresAt: string;
}
