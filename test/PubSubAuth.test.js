const assert = require('node:assert/strict');
const test = require('node:test');
const {PubSub} = require('@google-cloud/pubsub');

const {createPubSubAuth} = require('../dist/sdm/PubSubAuth');

test('constructs Pub/Sub authentication without deprecated credential options', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = warning => warnings.push(String(warning));

    try {
        const config = {
            clientId: 'client-id',
            clientSecret: 'client-secret',
            refreshToken: 'refresh-token',
            projectId: 'device-access-project',
            gcpProjectId: 'google-cloud-project'
        };
        const auth = createPubSubAuth(config);
        const client = new PubSub({projectId: config.gcpProjectId, auth});

        assert.equal(client.auth, auth);
        assert.equal(client.projectId, config.gcpProjectId);
        assert.deepEqual(warnings, []);
    } finally {
        console.warn = originalWarn;
    }
});
