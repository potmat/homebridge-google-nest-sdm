export interface StreamUrls {
    rtspUrl: string;
}

export interface GenerateRtspStream {
    streamUrls: StreamUrls;
    streamExtensionToken: string;
    streamToken: string;
    expiresAt: string;
}

export interface GenerateWebRtcStream {
    answerSdp: string;
    mediaSessionId: string;
    expiresAt: string;
}

export interface GenerateImage {
    url: string;
    token: string;
}
