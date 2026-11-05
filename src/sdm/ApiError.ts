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

const GRPC_STATUS_NAMES: Record<number, string> = {
    0: 'OK',
    1: 'CANCELLED',
    2: 'UNKNOWN',
    3: 'INVALID_ARGUMENT',
    4: 'DEADLINE_EXCEEDED',
    5: 'NOT_FOUND',
    6: 'ALREADY_EXISTS',
    7: 'PERMISSION_DENIED',
    8: 'RESOURCE_EXHAUSTED',
    9: 'FAILED_PRECONDITION',
    10: 'ABORTED',
    11: 'OUT_OF_RANGE',
    12: 'UNIMPLEMENTED',
    13: 'INTERNAL',
    14: 'UNAVAILABLE',
    15: 'DATA_LOSS',
    16: 'UNAUTHENTICATED'
};

/**
 * A short, credential-free description of a Pub/Sub gRPC error.
 */
export function describePubSubError(error: any): string {
    const numericCode = typeof error?.code === 'number' ? error.code : undefined;
    const code = numericCode === undefined
        ? undefined
        : `gRPC ${numericCode} ${GRPC_STATUS_NAMES[numericCode] ?? 'UNKNOWN'}`;
    const message = error?.details ?? error?.message;
    const parts = [code, message ? String(message).slice(0, 300) : undefined]
        .filter((part): part is string => Boolean(part));
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
