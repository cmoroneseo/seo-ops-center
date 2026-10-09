import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyReportDrafts, createReportDraftHandler, planReportDrafts, type DraftStore } from './report-drafts';
import { reportAutodraftEnabled } from './autodraft-flag';

const BUSINESS_DAY_3 = new Date('2026-11-04T16:00:00.000Z');
const BUSINESS_DAY_2 = new Date('2026-11-03T16:00:00.000Z');

const source = [
    readFileSync(new URL('./report-drafts.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('../../app/api/cron/report-drafts/route.ts', import.meta.url), 'utf8'),
].join('\n');

test('drafts are created on business day 3 and a second pass inserts nothing', async () => {
    const idle = planReportDrafts({
        now: BUSINESS_DAY_2,
        candidates: [{
            organizationId: 'org',
            clientId: 'c1',
            clientName: 'Scott Cole Plumbing',
            gscConnected: true,
            gscFinal: true,
            monthlyReportId: null,
            hasReview: false,
        }],
    });
    assert.equal(idle.due, false);

    const first = planReportDrafts({
        now: BUSINESS_DAY_3,
        candidates: [
            { organizationId: 'org', clientId: 'c1', clientName: 'Scott Cole Plumbing', gscConnected: true, gscFinal: true, monthlyReportId: null, hasReview: false },
            { organizationId: 'org', clientId: 'c2', clientName: 'No Console', gscConnected: false, gscFinal: false, monthlyReportId: null, hasReview: false },
            { organizationId: 'org', clientId: 'c3', clientName: 'Partial', gscConnected: true, gscFinal: false, monthlyReportId: null, hasReview: false },
            { organizationId: 'org', clientId: 'c4', clientName: 'Already', gscConnected: true, gscFinal: true, monthlyReportId: 'existing', hasReview: false },
        ],
    });
    assert.equal(first.due, true);
    if (!first.due) return;
    assert.equal(first.plan.reportMonth, '2026-10');
    assert.equal(first.plan.create.length, 1);
    assert.match(first.plan.create[0].title, /Scott Cole Plumbing — October 2026 SEO Report/);
    assert.equal(first.plan.skippedNoGsc, 1);
    assert.equal(first.plan.skippedNotFinal, 1);
    assert.equal(first.plan.ensureReview.length, 1);

    const reports = new Set<string>();
    const reviews: string[] = [];
    const store: DraftStore = {
        async insertReport(row) {
            const key = `${row.clientId}:${row.reportMonth}`;
            if (reports.has(key)) return { ok: false, conflict: true, unavailable: false };
            reports.add(key);
            return { ok: true, id: `report-${row.clientId}` };
        },
        async insertReview(row) {
            reviews.push(row.reportId);
            return { ok: true };
        },
        async deleteReport(id) {
            reviews.push(`deleted:${id}`);
        },
    };
    const applied = await applyReportDrafts(store, first.plan);
    assert.equal(applied.created, 1);
    assert.deepEqual(reviews, ['report-c1', 'existing']);
    const again = await applyReportDrafts(store, first.plan);
    assert.equal(again.created, 0);
    assert.equal(again.conflicts, 1);

    const healed = planReportDrafts({
        now: BUSINESS_DAY_3,
        candidates: [{
            organizationId: 'org',
            clientId: 'c1',
            clientName: 'Scott Cole Plumbing',
            gscConnected: true,
            gscFinal: true,
            monthlyReportId: 'report-c1',
            hasReview: true,
        }],
    });
    assert.equal(healed.due, true);
    if (!healed.due) return;
    assert.equal(healed.plan.create.length, 0);
    assert.equal(healed.plan.ensureReview.length, 0);
});

test('the cron stays dark unless the server flag is on, and it does not email', async () => {
    assert.equal(source.includes('resend'), false);
    assert.equal(source.includes('client_portal_email_queue'), false);
    assert.equal(source.includes('0 15 * * *') || source.includes('15:00'), true);
    const previous = process.env.REPORT_AUTODRAFT_ENABLED;
    try {
        delete process.env.REPORT_AUTODRAFT_ENABLED;
        assert.equal(reportAutodraftEnabled(), false);
        process.env.REPORT_AUTODRAFT_ENABLED = 'true';
        assert.equal(reportAutodraftEnabled(), true);
    } finally {
        if (previous === undefined) delete process.env.REPORT_AUTODRAFT_ENABLED;
        else process.env.REPORT_AUTODRAFT_ENABLED = previous;
    }

    let ran = false;
    const disabled = createReportDraftHandler({
        authorize: () => true,
        enabled: () => false,
        now: () => BUSINESS_DAY_3,
        run: async () => { ran = true; return { ok: false, status: 500, error: 'x' }; },
    });
    const skipped = await disabled(new Request('http://local/api/cron/report-drafts'));
    assert.equal(skipped.status, 200);
    assert.equal((await skipped.json()).reason, 'disabled');
    assert.equal(ran, false);

    const denied = await createReportDraftHandler({
        authorize: () => false,
        enabled: () => true,
        now: () => BUSINESS_DAY_3,
        run: async () => { ran = true; return { ok: true, skipped: true, reason: 'not_business_day_3', reportMonth: '2026-10' }; },
    })(new Request('http://local/api/cron/report-drafts'));
    assert.equal(denied.status, 401);
    assert.equal(ran, false);

    const leaked = await createReportDraftHandler({
        authorize: () => true,
        enabled: () => true,
        now: () => BUSINESS_DAY_3,
        run: async () => ({ ok: false, status: 500, error: 'duplicate key secret_client_email' }),
    })(new Request('http://local/api/cron/report-drafts', { headers: { authorization: 'Bearer secret' } }));
    const body = await leaked.json();
    assert.equal(leaked.status, 500);
    assert.equal(body.error, 'Report drafts will retry on the next run.');
    assert.equal(JSON.stringify(body).includes('secret_client_email'), false);
});
