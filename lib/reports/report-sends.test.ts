import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applySendPlan, createReportSendHandler, runReportSends, type SendStore } from './report-sends';
import { reportSendEnabled } from './send-flag';
import type { DueReview, PlannedSend } from './schedule';

const review: DueReview = {
    reviewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reportId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    versionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    state: 'approved',
    reportMonth: '2026-10',
    contactId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    scheduledFor: '2026-11-06T17:00:00.000Z',
    sendStatus: null,
};

function store(calls: string[]): SendStore {
    return {
        async listReviews() {
            calls.push('list');
            return { ok: true, reviews: [] };
        },
        async publishPortal() {
            calls.push('publish');
            return 'ok';
        },
        async insertSend(plan) {
            calls.push(plan.insert ? 'insert' : 'reuse');
            return { ok: true, id: 'send-1', inserted: plan.insert };
        },
        async enqueue() {
            calls.push('enqueue');
            return 'ok';
        },
        async scheduleReview() {
            calls.push('schedule');
            return 'ok';
        },
    };
}

test('the flag off means the cron reads nothing and writes nothing', async () => {
    let ran = false;
    const handler = createReportSendHandler({
        authorize: () => true,
        enabled: () => false,
        now: () => new Date(),
        windowOpen: () => true,
        run: async () => {
            ran = true;
            return { ok: true, skipped: false, emailed: 0, flaggedNoContact: 0, queued: 0, skippedCount: 0, conflicts: 0 };
        },
    });
    const response = await handler(new Request('http://localhost/api/cron/report-sends'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { skipped: true, reason: 'disabled' });
    assert.equal(ran, false);
});

test('outside 9:00 AM Pacific the cron does not read the queue', async () => {
    let ran = false;
    const handler = createReportSendHandler({
        authorize: () => true,
        enabled: () => true,
        now: () => new Date('2026-11-06T16:00:00.000Z'),
        windowOpen: () => false,
        run: async () => {
            ran = true;
            return { ok: true, skipped: true, reason: 'outside_send_window' };
        },
    });
    const response = await handler(new Request('http://localhost/api/cron/report-sends'));
    assert.equal((await response.json()).reason, 'outside_send_window');
    assert.equal(ran, false);
});

test('a bad cron secret is rejected before any read', async () => {
    let ran = false;
    const handler = createReportSendHandler({
        authorize: () => false,
        enabled: () => true,
        now: () => new Date(),
        windowOpen: () => true,
        run: async () => {
            ran = true;
            return { ok: false, status: 500, error: 'nope' };
        },
    });
    const response = await handler(new Request('http://localhost/api/cron/report-sends'));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'Unauthorized');
    assert.equal(ran, false);
});

test('an email is queued once, and a retry reuses the send row', async () => {
    const calls: string[] = [];
    const plan: PlannedSend = { action: 'email', reason: 'due', review, insert: true, scheduledFor: review.scheduledFor };
    const first = await applySendPlan(store(calls), [plan]);
    assert.equal(first.queued, 1);
    assert.deepEqual(calls, ['publish', 'schedule', 'insert', 'enqueue']);
    const retry: PlannedSend = {
        ...plan,
        reason: 'retry',
        insert: false,
        review: { ...review, state: 'scheduled', sendStatus: 'queued' },
    };
    const again = await applySendPlan(store(calls), [retry]);
    assert.equal(again.queued, 1);
    assert.equal(calls.filter(call => call === 'insert').length, 1);
    assert.equal(calls.includes('reuse'), true);
});

test('no contact publishes the portal and never enqueues email', async () => {
    const calls: string[] = [];
    const result = await applySendPlan(store(calls), [{
        action: 'portal_only',
        reason: 'no_contact',
        review: { ...review, contactId: null },
        insert: true,
        scheduledFor: review.scheduledFor,
    }]);
    assert.equal(result.flaggedNoContact, 1);
    assert.deepEqual(calls, ['publish', 'insert']);
});

test('a failed portal publish does not queue email', async () => {
    const calls: string[] = [];
    const broken = store(calls);
    broken.publishPortal = async () => {
        calls.push('publish');
        return 'conflict';
    };
    const result = await applySendPlan(broken, [{
        action: 'email',
        reason: 'due',
        review,
        insert: true,
        scheduledFor: review.scheduledFor,
    }]);
    assert.equal(result.conflicts, 1);
    assert.equal(result.queued, 0);
    assert.equal(calls.includes('enqueue'), false);
});

test('runReportSends refuses to read when the flag is off', async () => {
    const previous = process.env.REPORT_SEND_ENABLED;
    delete process.env.REPORT_SEND_ENABLED;
    const result = await runReportSends(new Date('2026-11-06T17:00:00.000Z'));
    assert.equal(result.ok, true);
    if (result.ok && result.skipped) assert.equal(result.reason, 'disabled');
    if (previous === undefined) delete process.env.REPORT_SEND_ENABLED;
    else process.env.REPORT_SEND_ENABLED = previous;
});

test('REPORT_SEND_ENABLED is on only for the exact string true', () => {
    const previous = process.env.REPORT_SEND_ENABLED;
    delete process.env.REPORT_SEND_ENABLED;
    assert.equal(reportSendEnabled(), false);
    process.env.REPORT_SEND_ENABLED = '1';
    assert.equal(reportSendEnabled(), false);
    process.env.REPORT_SEND_ENABLED = 'true';
    assert.equal(reportSendEnabled(), true);
    if (previous === undefined) delete process.env.REPORT_SEND_ENABLED;
    else process.env.REPORT_SEND_ENABLED = previous;
});

test('both Pacific cron hours are daily schedules', () => {
    const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');
    assert.equal(vercel.includes('"0 16 * * *"'), true);
    assert.equal(vercel.includes('"0 17 * * *"'), true);
    assert.equal(vercel.includes('/api/cron/report-sends'), true);
});

test('a database failure stays redacted', async () => {
    const source = readFileSync(new URL('./report-sends.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('Report sends will retry on the next run.'), true);
    assert.equal(/catch\s*\{[^}]*error\.message/.test(source), false);
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const previous = process.env.REPORT_SEND_ENABLED;
    process.env.REPORT_SEND_ENABLED = 'true';
    const down = await runReportSends(new Date('2026-11-06T17:00:00.000Z'));
    assert.equal(down.ok, false);
    if (!down.ok) assert.equal(down.error, 'Report sends will retry on the next run.');
    assert.equal(JSON.stringify(down).includes('Missing Supabase'), false);
    if (previous === undefined) delete process.env.REPORT_SEND_ENABLED;
    else process.env.REPORT_SEND_ENABLED = previous;
});
