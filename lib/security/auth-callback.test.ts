import { test } from 'node:test';
import assert from 'node:assert/strict';

test('auth callback ignores attacker-selected org query and never creates membership from it', async () => {
    const { createAuthCallbackGet } = await import('./auth-callback.ts');
    const get = createAuthCallbackGet({
        exchangeCode: async () => ({ id: 'user-1', email: 'user@example.com' }),
        consumeInvite: async () => { throw new Error('org query must not consume an invite'); },
        appOrigin: 'https://seo-ops.test',
    });

    const response = await get(new Request(
        'https://seo-ops.test/auth/callback?code=valid&org=org-victim',
    ));

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://seo-ops.test/dashboard');
});

test('auth callback consumes an email-bound invite token and rejects invalid or replayed tokens', async () => {
    const { createAuthCallbackGet } = await import('./auth-callback.ts');
    const consumed = new Set<string>();
    const get = createAuthCallbackGet({
        exchangeCode: async () => ({ id: 'user-1', email: 'user@example.com' }),
        consumeInvite: async (token, user) => {
            assert.deepEqual(user, { id: 'user-1', email: 'user@example.com' });
            if (token !== 'valid-token' || consumed.has(token)) return false;
            consumed.add(token);
            return true;
        },
        appOrigin: 'https://seo-ops.test',
    });
    const url = 'https://seo-ops.test/auth/callback?code=valid&invite=valid-token';

    const accepted = await get(new Request(url));
    const replayed = await get(new Request(url));

    assert.equal(accepted.headers.get('location'), 'https://seo-ops.test/dashboard');
    assert.match(replayed.headers.get('location') ?? '', /login\?error=/);
});
