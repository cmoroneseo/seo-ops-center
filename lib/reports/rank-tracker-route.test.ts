import test from 'node:test';
import assert from 'node:assert/strict';
import { createRankTrackerHandler } from './rank-tracker-route';
import type { ReportRow } from './reportStore';

const report = {
    id: '66666666-6666-4666-8666-666666666666',
    organization_id: 'org-a',
    client_id: '44444444-4444-4444-8444-444444444444',
    report_month: '2026-08',
} as ReportRow;

test('a cross-org report is not found and Ahrefs is not called', async () => {
    let called = false;
    const handler = createRankTrackerHandler({
        access: async () => ({ ok: false, status: 404, error: 'Not found' }),
        fetchAhrefsRankTracker: async () => { called = true; return { status: 'ok', rows: [] }; },
        now: () => new Date('2026-11-01T00:00:00Z'),
    });
    const response = await handler.GET(report.id, new Request('https://app.test/api/reports/x/rank-tracker'));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { status: 'error', message: 'Not found' });
    assert.equal(called, false);
});

test('limit and period parsing stay clamped to the existing bounds', async () => {
    const seen: { limit?: number; dateStart?: string; dateEnd?: string }[] = [];
    const handler = createRankTrackerHandler({
        access: async () => ({ ok: true, report, auth: { userId: 'u', actorName: 'Ada', organizationId: 'org-a', role: 'member', isManager: false } }),
        fetchAhrefsRankTracker: async (_client, dateStart, dateEnd, options) => {
            seen.push({ limit: options.limit, dateStart, dateEnd });
            return { status: 'ok', rows: [] };
        },
        now: () => new Date('2026-11-01T00:00:00Z'),
    });
    const high = await handler.GET(report.id, new Request('https://app.test/rank-tracker?limit=500&period=nope'));
    const low = await handler.GET(report.id, new Request('https://app.test/rank-tracker?limit=0&period=last_7d'));
    assert.equal(high.status, 200);
    assert.equal(seen[0].limit, 100);
    assert.equal(seen[0].dateStart, '2026-08-01');
    assert.equal(seen[0].dateEnd, '2026-08-31');
    assert.equal(seen[1].limit, 100);
    assert.equal(seen[1].dateStart, '2026-08-24');
    assert.equal(seen[1].dateEnd, '2026-08-31');
    const body = await low.json();
    assert.equal(body.dateStart, '2026-08-24');
});
