// Helpers for logging errors from the Google SDM API (googleapis / GaxiosError)
// and the event-image fetch (axios) WITHOUT leaking credentials.
//
// Both libraries attach the full outgoing request to the error they throw,
// including the `Authorization` header — a live OAuth Bearer token for SDM
// calls, or the `Basic` image token for the event-image fetch. As a result
// `JSON.stringify(error)` writes that credential straight into the Homebridge
// log, which users routinely paste into GitHub issues. Never stringify one of
// these errors; use describeApiError() to log a short, safe summary instead.

/**
 * True when an error is Google's rate-limit response (HTTP 429 /
 * RESOURCE_EXHAUSTED). Works for both GaxiosError and axios error shapes.
 */
export function isRateLimited(error: any): boolean {
    const status = error?.response?.status ?? error?.code;
    if (status === 429 || status === '429') return true;
    const message = apiMessage(error) ?? error?.message ?? '';
    return /rate limit|RESOURCE_EXHAUSTED/i.test(message);
}

/**
 * A short, credential-free description of a Google/axios error, safe to log.
 *
 * Reads only known scalar fields (HTTP status and the API's own error message);
 * it deliberately never touches `config`, `headers`, or the raw error object,
 * any of which can carry the Authorization token. The message is length-capped
 * as a belt-and-braces guard against an unexpectedly large field.
 */
export function describeApiError(error: any): string {
    const status = error?.response?.status ?? error?.code;
    const message = apiMessage(error) ?? error?.message;
    const parts: string[] = [];
    if (status !== undefined && status !== null) parts.push(`HTTP ${status}`);
    if (message) parts.push(String(message).slice(0, 300));
    return parts.length > 0 ? parts.join(': ') : 'unknown error';
}

// The human-readable message Google returns in the response body, from either
// the REST error envelope ({error:{message}}) or the errors[] array. Returns
// undefined when neither is present so callers can fall back to error.message.
function apiMessage(error: any): string | undefined {
    return error?.response?.data?.error?.message
        ?? error?.errors?.[0]?.message
        ?? undefined;
}
