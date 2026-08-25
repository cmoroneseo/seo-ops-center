import { test } from 'node:test';
import assert from 'node:assert/strict';

const request = (body: Record<string, unknown>) => new Request('https://seo-ops.test/api/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

test('invite rejects unauthenticated and non-admin callers before ledger, auth-admin, or email access', async () => {
    const { createInvitePost } = await import('./invite-route.ts');
    for (const denial of [
        { ok: false as const, status: 401, error: 'Unauthorized' },
        { ok: false as const, status: 403, error: 'Forbidden' },
    ]) {
        const post = createInvitePost({
            authorizeInviter: async () => denial,
            randomToken: () => { throw new Error('token must not be created'); },
            hashToken: () => { throw new Error('hash must not run'); },
            createInvite: async () => { throw new Error('ledger must not run'); },
            revokeInvite: async () => {},
            generateAuthLink: async () => { throw new Error('auth admin must not run'); },
            sendInviteEmail: async () => { throw new Error('email must not send'); },
            siteUrl: 'https://seo-ops.test',
            now: () => new Date('2026-08-20T00:00:00.000Z'),
        });

        const response = await post(request({ email: 'new@example.com', organizationId: 'org-victim' }));
        assert.equal(response.status, denial.status);
    }
});

test('invite binds a one-time ledger record and link to canonical inviter organization and email', async () => {
    const { createInvitePost } = await import('./invite-route.ts');
    let record: Record<string, unknown> | null = null;
    let mailed: Record<string, unknown> | null = null;
    const post = createInvitePost({
        authorizeInviter: async organizationId => {
            assert.equal(organizationId, 'org-a');
            return {
                ok: true,
                userId: 'admin-1',
                actorName: 'Canonical Admin',
                organizationId: 'org-a',
                organizationName: 'Canonical Org',
                role: 'admin',
            } as const;
        },
        randomToken: () => 'opaque-token',
        hashToken: value => `hash:${value}`,
        createInvite: async input => { record = input; },
        revokeInvite: async () => {},
        generateAuthLink: async (email, redirectTo) => {
            assert.equal(email, 'new@example.com');
            assert.equal(redirectTo, 'https://seo-ops.test/auth/callback?invite=opaque-token');
            return 'https://auth.test/action';
        },
        sendInviteEmail: async input => { mailed = input; },
        siteUrl: 'https://seo-ops.test',
        now: () => new Date('2026-08-20T00:00:00.000Z'),
    });

    const response = await post(request({
        email: ' NEW@Example.com ',
        organizationId: 'org-a',
        organizationName: 'Spoofed Org',
        invitedByName: 'Spoofed Inviter',
        role: 'owner',
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(record, {
        tokenHash: 'hash:opaque-token',
        organizationId: 'org-a',
        email: 'new@example.com',
        role: 'member',
        invitedBy: 'admin-1',
        expiresAt: '2026-08-27T00:00:00.000Z',
    });
    assert.deepEqual(mailed, {
        to: 'new@example.com',
        inviteUrl: 'https://auth.test/action',
        // Canonical id, not the caller-supplied one — the email's branding is
        // looked up from this, so it must come from the authorization result.
        organizationId: 'org-a',
        organizationName: 'Canonical Org',
        invitedByName: 'Canonical Admin',
    });
});
