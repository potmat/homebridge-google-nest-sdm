"use strict";
// Helpers for logging errors from the Google SDM API (googleapis / GaxiosError)
// and the event-image fetch (axios) WITHOUT leaking credentials.
//
// Both libraries attach the full outgoing request to the error they throw,
// including the `Authorization` header — a live OAuth Bearer token for SDM
// calls, or the `Basic` image token for the event-image fetch. As a result
// `JSON.stringify(error)` writes that credential straight into the Homebridge
// log, which users routinely paste into GitHub issues. Never stringify one of
// these errors; use describeApiError() to log a short, safe summary instead.
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeApiError = exports.isRateLimited = void 0;
/**
 * True when an error is Google's rate-limit response (HTTP 429 /
 * RESOURCE_EXHAUSTED). Works for both GaxiosError and axios error shapes.
 */
function isRateLimited(error) {
    var _a, _b, _c, _d;
    const status = (_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : error === null || error === void 0 ? void 0 : error.code;
    if (status === 429 || status === '429')
        return true;
    const message = (_d = (_c = apiMessage(error)) !== null && _c !== void 0 ? _c : error === null || error === void 0 ? void 0 : error.message) !== null && _d !== void 0 ? _d : '';
    return /rate limit|RESOURCE_EXHAUSTED/i.test(message);
}
exports.isRateLimited = isRateLimited;
/**
 * A short, credential-free description of a Google/axios error, safe to log.
 *
 * Reads only known scalar fields (HTTP status and the API's own error message);
 * it deliberately never touches `config`, `headers`, or the raw error object,
 * any of which can carry the Authorization token. The message is length-capped
 * as a belt-and-braces guard against an unexpectedly large field.
 */
function describeApiError(error) {
    var _a, _b, _c;
    const status = (_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : error === null || error === void 0 ? void 0 : error.code;
    const message = (_c = apiMessage(error)) !== null && _c !== void 0 ? _c : error === null || error === void 0 ? void 0 : error.message;
    const parts = [];
    if (status !== undefined && status !== null)
        parts.push(`HTTP ${status}`);
    if (message)
        parts.push(String(message).slice(0, 300));
    return parts.length > 0 ? parts.join(': ') : 'unknown error';
}
exports.describeApiError = describeApiError;
// The human-readable message Google returns in the response body, from either
// the REST error envelope ({error:{message}}) or the errors[] array. Returns
// undefined when neither is present so callers can fall back to error.message.
function apiMessage(error) {
    var _a, _b, _c, _d, _e, _f, _g;
    return (_g = (_d = (_c = (_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error) === null || _c === void 0 ? void 0 : _c.message) !== null && _d !== void 0 ? _d : (_f = (_e = error === null || error === void 0 ? void 0 : error.errors) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.message) !== null && _g !== void 0 ? _g : undefined;
}
//# sourceMappingURL=ApiError.js.map