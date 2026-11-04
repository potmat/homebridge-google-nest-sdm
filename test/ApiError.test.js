const assert = require('node:assert/strict');
const test = require('node:test');

const {describePubSubError} = require('../dist/sdm/ApiError');

test('describes a Pub/Sub gRPC error without serializing the raw error', () => {
    const error = {
        code: 7,
        details: 'User not authorized',
        config: {headers: {Authorization: 'Bearer secret-token'}}
    };

    const description = describePubSubError(error);

    assert.equal(description, 'gRPC 7 PERMISSION_DENIED: User not authorized');
    assert.doesNotMatch(description, /secret-token/);
});

test('caps Pub/Sub error messages', () => {
    const description = describePubSubError({code: 14, message: 'x'.repeat(500)});

    assert.equal(description, `gRPC 14 UNAVAILABLE: ${'x'.repeat(300)}`);
});

test('handles missing Pub/Sub error details', () => {
    assert.equal(describePubSubError(undefined), 'unknown error');
});
