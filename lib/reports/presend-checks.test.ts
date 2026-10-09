import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePresendChecks, rankCliff, type PresendInput } from './presend-checks';

const NOW = new Date('2026-10-08T17:00:00.000Z');

function input(patch: Partial<PresendInput> = {}): PresendInput {
    return {
        reportMonth: '2026-09',
        now: NOW,
        gsc: { connected: true, final: true, clicks: 65, impressions: 37906, lastSyncedAt: '2026-10-08T16:00:00.000Z', errored: false },
        sources: [
            { source: 'gsc', connected: true, errored: false, lastSyncedAt: '2026-10-08T16:00:00.000Z' },
            { source: 'ga4', connected: true, errored: false, lastSyncedAt: '2026-10-08T16:00:00.000Z' },
            { source: 'gbp', connected: false, errored: false, lastSyncedAt: null },
            { source: 'ahrefs', connected: true, errored: false, lastSyncedAt: '2026-10-08T16:00:00.000Z' },
        ],
        rankChecks: [],
        hours: 2,
        tasksCompleted: 1,
        shipped: 1,
        missingProofCount: 0,
        copyText: 'Google showed the business 37,906 times. That led to 65 clicks.',
        copySources: ['gsc'],
        amNote: null,
        hasRecipient: false,
        ...patch,
    };
}

function check(result: ReturnType<typeof evaluatePresendChecks>, id: string) {
    return result.checks.find(item => item.id === id);
}

test('a final month with work can be approved, and a missing contact is only a banner', () => {
    const result = evaluatePresendChecks(input());
    assert.equal(result.canApprove, true);
    assert.equal(result.canSchedule, false);
    assert.equal(result.banners[0]?.id, 'no_recipient');
    assert.equal(result.checks.some(item => item.id === 'no_recipient'), false);
});

test('Search Console that is not final blocks, and a real zero is not invented from missing days', () => {
    const partial = evaluatePresendChecks(input({
        gsc: { connected: true, final: false, clicks: null, impressions: null, lastSyncedAt: '2026-10-05T16:00:00.000Z', errored: false },
    }));
    assert.equal(partial.canApprove, false);
    assert.equal(check(partial, 'month_final')?.ok, false);
    assert.equal(check(partial, 'gsc_real_zero'), undefined);

    const disconnected = evaluatePresendChecks(input({
        gsc: { connected: false, final: false, clicks: null, impressions: null, lastSyncedAt: null, errored: false },
        sources: [{ source: 'gsc', connected: false, errored: false, lastSyncedAt: null }],
    }));
    assert.match(check(disconnected, 'month_final')?.message ?? '', /isn’t connected/);
});

test('a real zero and a month with no work block until the account manager writes a note', () => {
    const empty = evaluatePresendChecks(input({
        gsc: { connected: true, final: true, clicks: 0, impressions: 0, lastSyncedAt: NOW.toISOString(), errored: false },
        hours: 0,
        tasksCompleted: 0,
        shipped: 0,
    }));
    assert.equal(empty.canApprove, false);
    assert.equal(check(empty, 'gsc_real_zero')?.ok, false);
    assert.equal(check(empty, 'no_work')?.ok, false);

    const noted = evaluatePresendChecks(input({
        gsc: { connected: true, final: true, clicks: 0, impressions: 0, lastSyncedAt: NOW.toISOString(), errored: false },
        hours: 0,
        tasksCompleted: 0,
        shipped: 0,
        amNote: 'We had no new pages this month. Google recorded no searches.',
    }));
    assert.equal(noted.canApprove, true);
    assert.equal(check(noted, 'no_work')?.ok, true);
    assert.equal(check(noted, 'gsc_real_zero')?.ok, true);
});

test('Ahrefs errors and missing proof warn, and they never block', () => {
    const result = evaluatePresendChecks(input({
        sources: [
            { source: 'gsc', connected: true, errored: false, lastSyncedAt: NOW.toISOString() },
            { source: 'ahrefs', connected: true, errored: true, lastSyncedAt: '2026-09-01T00:00:00.000Z' },
            { source: 'gbp', connected: true, errored: true, lastSyncedAt: '2026-09-01T00:00:00.000Z' },
        ],
        missingProofCount: 4,
    }));
    const ahrefs = result.checks.find(item => item.id === 'sync_error' && item.source === 'ahrefs');
    const gbp = result.checks.find(item => item.id === 'sync_error' && item.source === 'gbp');
    assert.equal(ahrefs?.severity, 'warn');
    assert.equal(gbp?.severity, 'warn');
    assert.equal(check(result, 'missing_proof')?.severity, 'warn');
    assert.equal(check(result, 'missing_proof')?.message, '4 published deliverables this month are missing a live URL or ship date.');
    assert.equal(result.canApprove, true);
});

test('a Search Console sync error or stale sync blocks, and banned client copy blocks', () => {
    const errored = evaluatePresendChecks(input({
        sources: [{ source: 'gsc', connected: true, errored: true, lastSyncedAt: '2026-10-01T00:00:00.000Z' }],
    }));
    assert.equal(check(errored, 'sync_error')?.severity, 'blocking');
    assert.equal(errored.canApprove, false);

    const stale = evaluatePresendChecks(input({
        sources: [{ source: 'gsc', connected: true, errored: false, lastSyncedAt: '2026-10-01T00:00:00.000Z' }],
    }));
    assert.equal(check(stale, 'stale_data')?.severity, 'blocking');

    const copy = evaluatePresendChecks(input({
        copyText: '65 people clicked through from Google.',
    }));
    assert.equal(check(copy, 'client_copy')?.severity, 'blocking');
    assert.equal(copy.canApprove, false);
});

test('one rank check is never a drop', () => {
    assert.equal(rankCliff([{ position: 4 }]), false);
    assert.equal(rankCliff([{ position: 3 }, { position: 14 }]), true);
    assert.equal(rankCliff([{ position: 14 }, { position: 4 }]), false);
    const result = evaluatePresendChecks(input({ rankChecks: [{ position: 40 }] }));
    assert.equal(check(result, 'rank_cliff'), undefined);
    const cliff = evaluatePresendChecks(input({ rankChecks: [{ position: 4 }, { position: 20 }] }));
    assert.equal(check(cliff, 'rank_cliff')?.severity, 'warn');
    assert.equal(cliff.canApprove, true);
});
