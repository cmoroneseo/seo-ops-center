import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignedGoogleState, verifySignedGoogleState } from './oauth-state.ts';
import { signStatePayload } from './state-signature.ts';

function withSigningEnv(values: { state?: string; client?: string }, run: () => void) {
    const previousState = process.env.GOOGLE_OAUTH_STATE_SECRET;
    const previousClient = process.env.GOOGLE_CLIENT_SECRET;
    if (values.state === undefined) delete process.env.GOOGLE_OAUTH_STATE_SECRET;
    else process.env.GOOGLE_OAUTH_STATE_SECRET = values.state;
    if (values.client === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = values.client;
    try {
        run();
    } finally {
        if (previousState === undefined) delete process.env.GOOGLE_OAUTH_STATE_SECRET;
        else process.env.GOOGLE_OAUTH_STATE_SECRET = previousState;
        if (previousClient === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
        else process.env.GOOGLE_CLIENT_SECRET = previousClient;
    }
}

test('a signed Google state verifies, and a changed signature does not', () => {
    withSigningEnv({ state: 'state-signing-key' }, () => {
        const state = createSignedGoogleState({ clientId: 'client-1', orgId: 'org-1', group: 'gtm' });
        const verified = verifySignedGoogleState(state);
        assert.equal(verified?.clientId, 'client-1');
        assert.equal(verified?.orgId, 'org-1');
        assert.equal(verified?.group, 'gtm');

        const [payload, signature] = state.split('.');
        assert.equal(signature, signStatePayload(payload));
        const flipped = signature.endsWith('a') ? `${signature.slice(0, -1)}b` : `${signature.slice(0, -1)}a`;
        assert.equal(verifySignedGoogleState(`${payload}.${flipped}`), null);
        assert.equal(verifySignedGoogleState(`${payload}.${signature}.extra`), null);
    });
});

test('a state signed with the same key and an expired time does not verify', () => {
    withSigningEnv({ state: 'state-signing-key' }, () => {
        const payload = Buffer.from(JSON.stringify({
            clientId: 'client-1',
            orgId: 'org-1',
            group: 'ga4',
            exp: 1,
        }), 'utf8').toString('base64url');
        assert.equal(verifySignedGoogleState(`${payload}.${signStatePayload(payload)}`), null);
    });
});

test('the client secret is the signing key when the state key is unset', () => {
    withSigningEnv({ client: 'client-secret-key' }, () => {
        const state = createSignedGoogleState({ clientId: 'client-1', orgId: 'org-1', group: 'gsc' });
        assert.equal(verifySignedGoogleState(state)?.group, 'gsc');
    });
});
