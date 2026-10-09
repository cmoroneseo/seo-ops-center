import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportHandlers } from './report-routes';
import type { ReportRow } from './reportStore';

const org = '11111111-1111-4111-8111-111111111111';
const user = '33333333-3333-4333-8333-333333333333';
const client = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';
const reportId = '66666666-6666-4666-8666-666666666666';
const report = { id: reportId, organization_id: org, client_id: client, report_month: '2026-08', title: 'August' } as ReportRow;

function handlers(role: 'member' | 'viewer' = 'member', extras: Record<string, unknown> = {}) {
    const calls = { metrics: 0, updated: [] as unknown[], created: [] as unknown[], deleted: 0 };
    const api = createReportHandlers({
        requireOrganizationMember: async (orgId) => orgId === org
            ? { ok: true, userId: user, actorName: 'Ada', organizationId: org, role, isManager: false }
            : { ok: false, status: 403, error: 'Forbidden' },
        requireClientOrgMember: async (clientId) => clientId === client
            ? { ok: true, userId: user, organizationId: org, clientId: client, role }
            : { ok: false, status: 403, error: 'Forbidden' },
        getReport: async () => report,
        listReports: async () => [],
        createReport: async (params) => { calls.created.push(params); return { report }; },
        updateReport: async (_id, _org, patch) => { calls.updated.push(patch); return { report }; },
        deleteReport: async () => { calls.deleted += 1; return {}; },
        getClientMetrics: async () => { calls.metrics += 1; return []; },
        generateAutoSummary: () => ({ executiveSummary: 'summary', recommendations: 'recs' }),
        ...extras,
    });
    return { api, calls };
}

const json = (body: unknown) => new Request('https://app.test/api/reports', { method: 'POST', body: JSON.stringify(body) });

test('list rejects another organization and a client from outside it', async () => {
    const { api, calls } = handlers();
    assert.equal((await api.list(new Request('https://app.test/api/reports?orgId=other'))).status, 403);
    assert.equal((await api.list(new Request(`https://app.test/api/reports?orgId=${org}&clientId=${foreign}`))).status, 403);
    assert.equal(calls.metrics, 0);
});

test('create uses the signed-in user and rejects viewers, bad months, and foreign clients', async () => {
    const { api, calls } = handlers();
    const created = await api.create(json({ orgId: org, month: '2026-08', clientId: client, createdBy: 'attacker', clientName: 'North' }));
    assert.equal(created.status, 200);
    assert.equal((calls.created[0] as { createdBy: string }).createdBy, user);
    assert.equal((await handlers('viewer').api.create(json({ orgId: org, month: '2026-08' }))).status, 403);
    assert.equal((await api.create(json({ orgId: org, month: '2026-13' }))).status, 400);
    assert.equal((await api.create(json({ orgId: org, month: '2026-08', clientId: foreign }))).status, 403);
});

test('get hides a cross-org report and does not load its metrics', async () => {
    const { api, calls } = handlers('member', {
        requireOrganizationMember: async () => ({ ok: false, status: 403, error: 'Forbidden' }),
    });
    const response = await api.get(reportId);
    assert.equal(response.status, 404);
    assert.equal(calls.metrics, 0);
});

test('an approved report cannot be unpublished or deleted', async () => {
    const { api, calls } = handlers('member', { hasFrozenVersion: async () => true });
    assert.equal((await api.patch(reportId, json({ status: 'draft' }))).status, 409);
    assert.equal((await api.remove(reportId)).status, 409);
    assert.equal(calls.deleted, 0);
    assert.equal(calls.updated.length, 0);
    const open = handlers('member', { hasFrozenVersion: async () => false });
    assert.equal((await open.api.patch(reportId, json({ status: 'draft' }))).status, 200);
});

test('patch keeps only allowlisted fields', async () => {
    const { api, calls } = handlers();
    const response = await api.patch(reportId, json({ title: 'October', pdf_url: 'https://secret', organization_id: 'other', created_by: 'attacker' }));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.updated[0], { title: 'October' });
    assert.equal((await api.patch(reportId, json({ client_id: foreign }))).status, 403);
    assert.equal((await api.patch(reportId, json({ status: 'archived' }))).status, 400);
    assert.equal((await api.patch(reportId, json({ pdf_url: 'https://secret' }))).status, 400);
});

test('get includes each metric updated_at for the report caption', async () => {
    const { api } = handlers('member', {
        getClientMetrics: async () => [{
            source: 'gsc',
            metric_month: '2026-08',
            data: { organic_clicks: 65 },
            source_type: 'auto',
            updated_at: '2026-09-02T12:00:00.000Z',
        }],
    });
    const response = await api.get(reportId);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.metrics.updatedAt.gsc, '2026-09-02T12:00:00.000Z');
});

test('a viewer cannot delete, and a store error does not echo database text', async () => {
    assert.equal((await handlers('viewer').api.remove(reportId)).status, 403);
    const { api } = handlers('member', {
        updateReport: async () => ({ error: 'duplicate key value violates unique constraint reports_pkey' }),
    });
    const response = await api.patch(reportId, json({ title: 'October' }));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, 'Unable to save report');
    assert.doesNotMatch(JSON.stringify(body), /duplicate|reports_pkey/);
});
