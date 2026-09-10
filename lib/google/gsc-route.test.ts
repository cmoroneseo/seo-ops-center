import test from 'node:test';
import assert from 'node:assert/strict';
import { createGscHandlers, type GscDependencies } from './gsc-route';

function setup(overrides: Partial<GscDependencies> = {}) {
    const saved: unknown[] = []; const events: unknown[] = [];
    const deps: GscDependencies = {
        authorize: async () => ({ ok: true, clientId: 'c', organizationId: 'o', userId: 'u', actorName: 'User' }),
        load: async () => ({ token: 'secret', credentials: { site_url: 'sc-domain:old.com' } }),
        catalog: async () => [{ siteUrl: 'sc-domain:new.com', permissionLevel: 'siteOwner' }],
        save: async (_auth, site) => { saved.push(site); },
        activity: async (_auth, site) => { events.push(site); },
        ...overrides,
    };
    return { handler: createGscHandlers(deps), saved, events };
}
const request = (siteUrl: unknown) => new Request('https://app.test/api', { method: 'POST', body: JSON.stringify({ clientId: 'c', siteUrl }) });
test('unavailable property never saves or logs a connection', async () => {
    const { handler, saved, events } = setup();
    assert.equal((await handler.POST(request('https://new.com/'))).status, 400);
    assert.equal(saved.length, 0); assert.equal(events.length, 0);
});
test('successful exact selection is persisted before activity', async () => {
    const { handler, saved, events } = setup();
    assert.equal((await handler.POST(request('sc-domain:new.com'))).status, 200);
    assert.deepEqual(saved, [{ siteUrl: 'sc-domain:new.com', permissionLevel: 'siteOwner' }]);
    assert.equal(events.length, 1);
});
test('persistence failure cannot return success or log completion', async () => {
    const { handler, events } = setup({ save: async () => { throw new Error('database unavailable'); } });
    assert.equal((await handler.POST(request('sc-domain:new.com'))).status, 500);
    assert.equal(events.length, 0);
});
test('unauthorized request cannot enumerate properties or mutate them', async () => {
    const { handler } = setup({ authorize: async () => ({ ok: false, status: 403, error: 'Forbidden' }), load: async () => { throw new Error('must not load'); } });
    assert.equal((await handler.GET(new Request('https://app.test/api?clientId=c'))).status, 403);
    assert.equal((await handler.POST(request('sc-domain:new.com'))).status, 403);
});
test('catalog returns current selection without token credentials', async () => {
    const { handler } = setup();
    const response = await handler.GET(new Request('https://app.test/api?clientId=c'));
    const body = await response.json();
    assert.equal(body.selectedSiteUrl, 'sc-domain:old.com');
    assert.equal(JSON.stringify(body).includes('secret'), false);
});

test('logo lookup failure never blocks the authorized property catalog', async () => {
    const { handler } = setup({ branding: async () => { throw new Error('logo lookup unavailable'); } });
    const response = await handler.GET(new Request('https://app.test/api?clientId=c'));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sites[0].siteUrl, 'sc-domain:new.com');
});
