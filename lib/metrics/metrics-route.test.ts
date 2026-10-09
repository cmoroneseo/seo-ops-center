import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsHandlers, type MetricsRouteDeps } from './metrics-route';

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';
const client = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';

function handlers(role: 'member' | 'viewer' = 'member', known = client) {
    const written: unknown[] = [];
    const removed: unknown[] = [];
    const deps: MetricsRouteDeps = {
        requireClientOrgMember: async (clientId) => clientId === known
            ? { ok: true, userId: user, organizationId: org, clientId: known, role }
            : { ok: false, status: 403, error: 'Forbidden' },
        getClientMetrics: async () => [],
        writeMetric: async (params) => { written.push(params); return { success: true, outcome: 'inserted' }; },
        deleteManualMetric: async (params) => { removed.push(params); return params.source === 'gbp' ? 'deleted' : 'not_found'; },
        now: () => new Date('2026-10-15T18:00:00Z'),
    };
    return { api: createMetricsHandlers(deps), written, removed };
}

const post = (body: unknown) => new Request('https://app.test/api/metrics', { method: 'POST', body: JSON.stringify(body) });

test('metrics reads and writes stay inside the caller organization', async () => {
    const { api, written } = handlers();
    assert.equal((await api.list(new Request(`https://app.test/api/metrics?clientId=${foreign}`))).status, 403);
    const saved = await api.create(post({ clientId: client, orgId: other, source: 'gbp', metricMonth: '2026-10', data: { calls: 4 } }));
    assert.equal(saved.status, 200);
    assert.equal((written[0] as { organizationId: string }).organizationId, org);
    assert.equal((await handlers('viewer').api.create(post({ clientId: client, source: 'gbp', metricMonth: '2026-10', data: { calls: 4 } }))).status, 403);
});

test('manual metric values are checked before they are stored', async () => {
    const { api } = handlers();
    const body = { clientId: client, source: 'gsc', metricMonth: '2026-10' };
    assert.equal((await api.create(post({ ...body, data: { not_a_metric: 1 } }))).status, 400);
    assert.equal((await api.create(post({ ...body, data: { organic_clicks: -1 } }))).status, 400);
    assert.equal((await api.create(post({ ...body, data: { ctr: 1.2 } }))).status, 400);
    assert.equal((await api.create(post({ ...body, data: { organic_clicks: null } }))).status, 400);
    assert.equal((await api.create(post({ ...body, metricMonth: '2026-11', data: { organic_clicks: 1 } }))).status, 400);
    assert.equal((await api.create(post({ ...body, data: { organic_clicks: 3, ctr: 1 } }))).status, 200);
});

test('revert deletes a manual row and leaves a synced row alone', async () => {
    const { api, removed } = handlers();
    assert.equal((await api.remove(new Request(`https://app.test/api/metrics?clientId=${client}&source=gbp&metricMonth=2026-10`))).status, 200);
    assert.equal(removed.length, 1);
    assert.equal((await api.remove(new Request(`https://app.test/api/metrics?clientId=${client}&source=ga4&metricMonth=2026-10`))).status, 404);
    assert.equal((await handlers('viewer').api.remove(new Request(`https://app.test/api/metrics?clientId=${client}&source=gbp&metricMonth=2026-10`))).status, 403);
});
