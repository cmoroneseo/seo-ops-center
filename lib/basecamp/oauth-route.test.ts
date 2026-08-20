import { test } from 'node:test';
import assert from 'node:assert/strict';

type OAuthModule = typeof import('./oauth-route.ts');

async function loadOAuthModule(): Promise<OAuthModule> {
    try {
        return await import('./oauth-route.ts');
    } catch (error) {
        assert.fail(`Basecamp OAuth state and handlers must be implemented: ${String(error)}`);
    }
}

test('Basecamp OAuth state rejects tampering, expiry, and unsafe return destinations', async () => {
    const { createBasecampOAuthState, verifyBasecampOAuthState } = await loadOAuthModule();
    const state = createBasecampOAuthState({
        userId: 'user-1',
        returnTo: '/settings',
        nowSeconds: 1_000,
        nonce: 'nonce-123',
        secret: 'state-secret',
    });

    assert.deepEqual(verifyBasecampOAuthState(state, 'state-secret', 1_001), {
        userId: 'user-1',
        returnTo: '/settings',
        nonce: 'nonce-123',
        exp: 1_600,
    });
    assert.equal(verifyBasecampOAuthState(`${state}x`, 'state-secret', 1_001), null);
    assert.equal(verifyBasecampOAuthState(state, 'state-secret', 1_601), null);
    assert.throws(() => createBasecampOAuthState({
        userId: 'user-1',
        returnTo: 'https://attacker.test',
        nowSeconds: 1_000,
        nonce: 'nonce-123',
        secret: 'state-secret',
    }));
});

test('Basecamp connect rejects unauthenticated callers before issuing state', async () => {
    const { createBasecampOAuthHandlers } = await loadOAuthModule();
    const handlers = createBasecampOAuthHandlers({
        getUserId: async () => null,
        issueState: () => { throw new Error('state must not be issued'); },
        setStateCookie: async () => { throw new Error('cookie must not be set'); },
        consumeStateCookie: async () => null,
        verifyState: () => null,
        getConfiguration: () => { throw new Error('configuration must not be read'); },
        exchangeCode: async () => { throw new Error('provider must not be called'); },
    });

    const response = await handlers.connect(new Request('https://seo-ops.test/api/integrations/basecamp/connect'));

    assert.equal(response.status, 401);
});

test('Basecamp callback rejects missing, mismatched, replayed, and wrong-user state before exchange', async () => {
    const { createBasecampOAuthHandlers } = await loadOAuthModule();
    const validState = 'signed-state';
    let cookie: string | null = validState;
    let exchanges = 0;
    const handlers = createBasecampOAuthHandlers({
        getUserId: async () => 'user-1',
        issueState: () => validState,
        setStateCookie: async () => {},
        consumeStateCookie: async () => {
            const value = cookie;
            cookie = null;
            return value;
        },
        verifyState: state => state === validState ? {
            userId: 'user-1',
            returnTo: '/settings',
            nonce: 'nonce-1',
            exp: 1_600,
        } : null,
        getConfiguration: () => ({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://seo-ops.test/callback' }),
        exchangeCode: async () => { exchanges += 1; return { accessToken: 'access', refreshToken: 'refresh' }; },
    });

    const mismatched = await handlers.callback(new Request(
        'https://seo-ops.test/api/integrations/basecamp/callback?code=code&state=other',
    ));
    assert.equal(mismatched.status, 400);
    assert.equal(exchanges, 0);

    cookie = validState;
    const valid = await handlers.callback(new Request(
        `https://seo-ops.test/api/integrations/basecamp/callback?code=code&state=${validState}`,
    ));
    assert.equal(valid.status, 503);
    assert.equal(exchanges, 1);

    const replay = await handlers.callback(new Request(
        `https://seo-ops.test/api/integrations/basecamp/callback?code=code&state=${validState}`,
    ));
    assert.equal(replay.status, 400);
    assert.equal(exchanges, 1);

    cookie = validState;
    const wrongUserHandlers = createBasecampOAuthHandlers({
        getUserId: async () => 'user-2',
        issueState: () => validState,
        setStateCookie: async () => {},
        consumeStateCookie: async () => { const value = cookie; cookie = null; return value; },
        verifyState: () => ({ userId: 'user-1', returnTo: '/settings', nonce: 'nonce-1', exp: 1_600 }),
        getConfiguration: () => ({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://seo-ops.test/callback' }),
        exchangeCode: async () => { exchanges += 1; return { accessToken: 'access', refreshToken: 'refresh' }; },
    });
    const wrongUser = await wrongUserHandlers.callback(new Request(
        `https://seo-ops.test/api/integrations/basecamp/callback?code=code&state=${validState}`,
    ));
    assert.equal(wrongUser.status, 403);
    assert.equal(exchanges, 1);
});

test('successful callback never returns provider credentials in its response', async () => {
    const { createBasecampOAuthHandlers } = await loadOAuthModule();
    const handlers = createBasecampOAuthHandlers({
        getUserId: async () => 'user-1',
        issueState: () => 'signed-state',
        setStateCookie: async () => {},
        consumeStateCookie: async () => 'signed-state',
        verifyState: () => ({ userId: 'user-1', returnTo: '/settings', nonce: 'nonce-1', exp: 1_600 }),
        getConfiguration: () => ({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://seo-ops.test/callback' }),
        exchangeCode: async () => ({ accessToken: 'access-secret', refreshToken: 'refresh-secret' }),
    });

    const response = await handlers.callback(new Request(
        'https://seo-ops.test/api/integrations/basecamp/callback?code=code&state=signed-state',
    ));
    const text = await response.text();

    assert.equal(response.status, 503);
    assert.doesNotMatch(text, /access-secret|refresh-secret/);
    assert.match(text, /secure operator provisioning/i);
});
