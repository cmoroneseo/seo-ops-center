import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewPage, portalViewHref, resolvePortalPreview } from './preview-policy.ts';
import { clientPortalAllowedPath, safePortalNext } from './access-policy.ts';

const clientId = '11111111-1111-4111-8111-111111111111';
const base = `/portal-preview/${clientId}`;
const scope = { clientId, organizationId: 'org-a', clientName: 'Client A', organizationName: 'Agency A' };

test('client identities and magic links cannot enter staff preview', () => {
    assert.equal(clientPortalAllowedPath(base), false);
    assert.equal(clientPortalAllowedPath(`${base}/messages`), false);
    assert.equal(safePortalNext(base), '/portal');
});

test('preview keeps all portal navigation and anchors in the chosen client view', () => {
    for (const suffix of ['', '/plan', '/pending#waiting-123', '/messages#message-compose', '/reports', `/reports/${clientId}`]) {
        assert.equal(portalViewHref(`/portal${suffix}`, base), `${base}${suffix}`);
        assert.equal(portalViewHref(`/portal${suffix}`), `/portal${suffix}`);
    }
    assert.equal(portalViewHref('#first-90-days', base), '#first-90-days');
    assert.equal(portalViewHref('https://published.example/page', base), 'https://published.example/page');
});

test('preview admits only hub pages and valid report ids, rejecting action routes', () => {
    assert.deepEqual(previewPage(), { page: 'home' });
    for (const page of ['plan', 'pending', 'messages', 'reports']) assert.deepEqual(previewPage([page]), { page });
    assert.deepEqual(previewPage(['reports', clientId]), { page: 'report', reportId: clientId });
    for (const path of [['login'], ['decision'], ['reports', 'invalid'], ['messages', 'send'], ['api', 'client-portal'], ['..']]) {
        assert.equal(previewPage(path), null);
    }
});

test('preview rejects anonymous, client-only and cross-organization actors before data access', async () => {
    for (const status of [401, 403, 404, 500]) {
        const result = await resolvePortalPreview(clientId, {
            authorize: async () => ({ ok: false, status, error: 'Denied' }),
            readScope: async () => { throw new Error('Must not read data before authorization'); },
        });
        assert.deepEqual(result, { ok: false, status, error: 'Denied' });
    }
});

test('preview resolves canonical tenant scope and fails closed on mismatched data', async () => {
    const authorize = async () => ({ ok: true as const, clientId, organizationId: 'org-a' });
    assert.deepEqual(await resolvePortalPreview(clientId, { authorize, readScope: async (id, org) => {
        assert.equal(id, clientId); assert.equal(org, 'org-a'); return scope;
    } }), { ok: true, scope });
    for (const badScope of [null, { ...scope, organizationId: 'org-b' }, { ...scope, clientId: '22222222-2222-4222-8222-222222222222' }]) {
        assert.equal((await resolvePortalPreview(clientId, { authorize, readScope: async () => badScope })).ok, false);
    }
    assert.equal((await resolvePortalPreview('invalid', { authorize: async () => { throw new Error('Must not query'); }, readScope: async () => null })).ok, false);
});
