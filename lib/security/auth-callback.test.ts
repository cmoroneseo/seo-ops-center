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

test('portal invite lands on the portal and cannot be pointed at the staff app', async () => {
    const { createAuthCallbackGet } = await import('./auth-callback.ts');
    const get = createAuthCallbackGet({
        exchangeCode: async () => ({ id: 'client-1', email: 'client@example.com' }),
        consumeInvite: async () => { throw new Error('staff invite must not run'); },
        consumePortalInvite: async (token, user) => {
            assert.equal(token, 'portal-token');
            assert.equal(user.email, 'client@example.com');
            return true;
        },
        appOrigin: 'https://seo-ops.test',
    });

    const response = await get(new Request(
        'https://seo-ops.test/auth/callback?code=valid&portal_invite=portal-token&next=/dashboard',
    ));
    assert.equal(response.headers.get('location'), 'https://seo-ops.test/portal');
});

test('a rejected portal invite returns to the portal login', async () => {
    const { createAuthCallbackGet } = await import('./auth-callback.ts');
    const get = createAuthCallbackGet({
        exchangeCode: async () => ({ id: 'client-1', email: 'client@example.com' }),
        consumeInvite: async () => true,
        consumePortalInvite: async () => false,
        appOrigin: 'https://seo-ops.test',
    });
    const response = await get(new Request(
        'https://seo-ops.test/auth/callback?code=valid&portal_invite=used&next=/portal/plan',
    ));
    assert.match(response.headers.get('location') ?? '', /\/portal\/login\?error=/);
});

test('a returning portal magic link can open the plan', async () => {
    const { createAuthCallbackGet } = await import('./auth-callback.ts');
    const get = createAuthCallbackGet({
        exchangeCode: async () => ({ id: 'client-1', email: 'client@example.com' }),
        consumeInvite: async () => { throw new Error('no invite on a returning link'); },
        appOrigin: 'https://seo-ops.test',
    });
    const response = await get(new Request(
        'https://seo-ops.test/auth/callback?code=valid&next=/portal/plan',
    ));
    assert.equal(response.headers.get('location'), 'https://seo-ops.test/portal/plan');
});

test('notification links select only a live client verified after authentication', async () => {
    const { createAuthCallbackGet } = await import('./auth-callback.ts');
    const allowed = '22222222-2222-4222-8222-222222222222';
    const selected: string[] = [];
    const get = createAuthCallbackGet({
        exchangeCode: async () => ({ id: 'client-1', email: 'client@example.com' }),
        consumeInvite: async () => true,
        selectPortalClient: async (id, user) => { assert.equal(user.id, 'client-1'); selected.push(id); return id === allowed; },
        appOrigin: 'https://seo-ops.test',
    });
    const open = (id: string) => get(new Request(`https://seo-ops.test/auth/callback?code=valid&next=/portal/plan&portal_client=${id}`));
    assert.equal((await open(allowed)).headers.get('location'), 'https://seo-ops.test/portal/plan');
    assert.match((await open('77777777-7777-4777-8777-777777777777')).headers.get('location') ?? '', /\/portal\/login\?error=/);
    assert.match((await open('invalid')).headers.get('location') ?? '', /\/portal\/login\?error=/);
    assert.equal(selected.length, 2);
});
