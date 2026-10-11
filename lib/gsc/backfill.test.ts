import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    AUTH_SKIP_DELAY_SECONDS, BACKFILL_CHAIN_LIMIT, BACKFILL_LINK_SPACING_MS, BACKFILL_MAX_DAYS,
    BACKFILL_MIN_DAY_MS, BACKFILL_QUEUE_RETENTION_SECONDS, BACKFILL_QUEUE_TOPIC, QUOTA_BACKOFF_BASE_SECONDS,
    QUOTA_BACKOFF_CAP_SECONDS, backfillLockIsLive, backfillLockStatusAfterContinuation, backfillPropertyDaysPerHour,
    backfillQueueDelaySeconds, backfillWorkRemains, canStartBackfillDay, daysDoneFromCursor, gscBackfillJobClaimable,
    historyFactsWithinLimit, isGscQuotaError, nextBackfillQueueMessage, parseBackfillChain, parseBackfillQueueMessage,
    quotaDelaySeconds, shouldContinueBackfill, v2DayFactUpperBound,
} from './backfill';
import { backgroundHistoryDates, planV2Backfill, V2_BACKFILL_HISTORY_DAYS } from './background';
import { dateOffset, GSC_HISTORY_FACT_LIMIT } from './history';

const now = new Date('2026-10-01T18:00:00Z');
const property = 'sc-domain:example.com';
const connected = { syncStatus: 'active', siteUrl: property };

test('a v2 day stays under the 25k replace_gsc_history_day cap', () => {
    const upper = v2DayFactUpperBound();
    assert.equal(upper, 20014);
    assert.ok(upper <= GSC_HISTORY_FACT_LIMIT);
    assert.equal(historyFactsWithinLimit(upper), true);
    assert.equal(historyFactsWithinLimit(GSC_HISTORY_FACT_LIMIT + 1), false);
    assert.equal(historyFactsWithinLimit(-1), false);
});

test('a link starts another day only while time and the day cap remain', () => {
    assert.equal(canStartBackfillDay({ remainingMs: BACKFILL_MIN_DAY_MS, daysThisRun: 0 }), true);
    assert.equal(canStartBackfillDay({ remainingMs: BACKFILL_MIN_DAY_MS - 1, daysThisRun: 0 }), false);
    assert.equal(canStartBackfillDay({ remainingMs: 60_000, daysThisRun: BACKFILL_MAX_DAYS }), false);
    assert.equal(canStartBackfillDay({ remainingMs: 60_000, daysThisRun: BACKFILL_MAX_DAYS - 1, maxDays: BACKFILL_MAX_DAYS }), true);
});

test('backfill batches several days and resumes from the last saved cursor', () => {
    const dates = backgroundHistoryDates(now, V2_BACKFILL_HISTORY_DAYS);
    const first = planV2Backfill(dates, null, BACKFILL_MAX_DAYS);
    assert.equal(first.dates.length, BACKFILL_MAX_DAYS);
    assert.deepEqual(first.dates, dates.slice(0, BACKFILL_MAX_DAYS));
    const killed = planV2Backfill(dates, first.dates[2], BACKFILL_MAX_DAYS);
    assert.equal(killed.dates[0], dates[3]);
    assert.equal(killed.dates.length, BACKFILL_MAX_DAYS);
    const done = planV2Backfill(dates, dates.at(-1)!, BACKFILL_MAX_DAYS);
    assert.equal(done.done, true);
    assert.deepEqual(done.dates, []);
});

test('days done counts the newest-first cursor out of 486', () => {
    const dates = backgroundHistoryDates(now, V2_BACKFILL_HISTORY_DAYS);
    assert.deepEqual(daysDoneFromCursor(null, now), { daysDone: 0, daysTotal: 486 });
    assert.deepEqual(daysDoneFromCursor(dates[0], now), { daysDone: 1, daysTotal: 486 });
    assert.deepEqual(daysDoneFromCursor(dates[9], now), { daysDone: 10, daysTotal: 486 });
    assert.deepEqual(daysDoneFromCursor(dates.at(-1)!, now), { daysDone: 486, daysTotal: 486 });
    assert.deepEqual(daysDoneFromCursor(dateOffset(dates.at(-1)!, -1), now), { daysDone: 486, daysTotal: 486 });
});

test('claim skips idle, future, disconnected, and live-leased jobs', () => {
    const available = new Date(now.getTime() - 1000).toISOString();
    const future = new Date(now.getTime() + 86_400_000).toISOString();
    const base = {
        kind: 'v2_backfill' as const,
        status: 'pending' as const,
        availableAt: available,
        leaseUntil: null,
        property,
        integration: connected,
    };
    assert.equal(gscBackfillJobClaimable(base, now), true);
    assert.equal(gscBackfillJobClaimable({ ...base, status: 'idle', availableAt: future }, now), false);
    assert.equal(gscBackfillJobClaimable({ ...base, status: 'idle', availableAt: available }, now), false);
    assert.equal(gscBackfillJobClaimable({ ...base, availableAt: future }, now), false);
    assert.equal(gscBackfillJobClaimable({ ...base, status: 'running', leaseUntil: future }, now), false);
    assert.equal(gscBackfillJobClaimable({ ...base, status: 'running', leaseUntil: available }, now), true);
    assert.equal(gscBackfillJobClaimable({ ...base, kind: 'daily' }, now), false);
    assert.equal(gscBackfillJobClaimable({ ...base, integration: { syncStatus: 'disconnected', siteUrl: property } }, now), false);
    assert.equal(gscBackfillJobClaimable({ ...base, integration: { syncStatus: 'active', siteUrl: 'sc-domain:other.com' } }, now), false);
    assert.equal(gscBackfillJobClaimable({ ...base, integration: null }, now), false);
});

test('quota backoff starts at 15 minutes and stays capped', () => {
    assert.equal(quotaDelaySeconds(1), QUOTA_BACKOFF_BASE_SECONDS);
    assert.equal(quotaDelaySeconds(2), QUOTA_BACKOFF_BASE_SECONDS * 2);
    assert.equal(quotaDelaySeconds(100), QUOTA_BACKOFF_CAP_SECONDS);
    assert.equal(AUTH_SKIP_DELAY_SECONDS, 6 * 60 * 60);
    assert.equal(isGscQuotaError(new Error('GSC history request failed (HTTP 429, quota)')), true);
    assert.equal(isGscQuotaError(new Error('GSC history request failed (HTTP 403, quota)')), true);
    assert.equal(isGscQuotaError(new Error('GSC history request failed (HTTP 500)')), false);
    assert.equal(isGscQuotaError(new Error('Snapshot was not saved')), false);
    assert.equal(isGscQuotaError('HTTP 429'), false);
});

test('the chain continues only while a link saved days and work is still claimable', () => {
    const current = new Date(now.getTime() - 1000).toISOString();
    const later = new Date(now.getTime() + 60_000).toISOString();
    assert.equal(backfillWorkRemains([
        { status: 'pending', availableAt: current, daysDone: 8, daysTotal: 486 },
        { status: 'idle', availableAt: later, daysDone: 12, daysTotal: 486 },
    ], now.getTime()), true);
    assert.equal(backfillWorkRemains([
        { status: 'idle', availableAt: later, daysDone: 10, daysTotal: 486 },
        { status: 'pending', availableAt: later, daysDone: 4, daysTotal: 486 },
    ], now.getTime()), false);
    assert.equal(backfillWorkRemains([
        { status: 'pending', availableAt: current, daysDone: 486, daysTotal: 486 },
    ], now.getTime()), false);
    assert.equal(shouldContinueBackfill({ chain: 0, imported: 8, quotaPaused: false, workRemains: true }), true);
    assert.equal(shouldContinueBackfill({ chain: 0, imported: 0, quotaPaused: false, workRemains: true }), false);
    assert.equal(shouldContinueBackfill({ chain: 0, imported: 8, quotaPaused: true, workRemains: true }), false);
    assert.equal(shouldContinueBackfill({ chain: BACKFILL_CHAIN_LIMIT, imported: 8, quotaPaused: false, workRemains: true }), false);
    assert.equal(parseBackfillChain(null), 0);
    assert.equal(parseBackfillChain('14'), 14);
    assert.equal(parseBackfillChain(String(BACKFILL_CHAIN_LIMIT)), BACKFILL_CHAIN_LIMIT);
    assert.equal(parseBackfillChain(String(BACKFILL_CHAIN_LIMIT + 1)), null);
    assert.equal(parseBackfillChain('1e2'), null);
    assert.equal(parseBackfillChain('-1'), null);
});

test('the next batch is a queue message, spaced so a 10-minute window stays small', () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    assert.equal(backfillQueueDelaySeconds(0), BACKFILL_LINK_SPACING_MS / 1000);
    assert.equal(backfillQueueDelaySeconds(100_000), 80);
    assert.equal(backfillQueueDelaySeconds(BACKFILL_LINK_SPACING_MS + 5_000), 0);
    assert.equal(backfillPropertyDaysPerHour(BACKFILL_MAX_DAYS), 240);
    assert.equal(backfillPropertyDaysPerHour(8), 160);
    assert.equal(backfillPropertyDaysPerHour(0), 0);
    const next = nextBackfillQueueMessage({ runId, chain: 4, elapsedMs: 40_000, continueChain: true });
    assert.equal(next?.chain, 5);
    assert.equal(next?.delaySeconds, 140);
    assert.equal(next?.idempotencyKey, `gsc-v2-backfill:${runId}:5`);
    assert.equal(next?.retentionSeconds, BACKFILL_QUEUE_RETENTION_SECONDS);
    assert.ok((next?.idempotencyKey.length ?? 0) <= 256);
    assert.equal(nextBackfillQueueMessage({ runId, chain: 4, elapsedMs: 40_000, continueChain: false }), null);
    assert.equal(nextBackfillQueueMessage({ runId, chain: BACKFILL_CHAIN_LIMIT, elapsedMs: 0, continueChain: true }), null);
    assert.equal(parseBackfillQueueMessage({ runId, chain: 5 })?.chain, 5);
    assert.equal(parseBackfillQueueMessage({ runId, chain: 0 }), null);
    assert.equal(parseBackfillQueueMessage({ runId: 'not-a-uuid', chain: 5 }), null);
    assert.equal(parseBackfillQueueMessage({ runId, chain: '5' }), null);
    assert.equal(parseBackfillQueueMessage(null), null);
    assert.equal(backfillLockStatusAfterContinuation('completed', 'continuation_queue_failed'), 'partial');
    assert.equal(backfillLockStatusAfterContinuation('failed', 'continuation_queue_failed'), 'failed');
    assert.equal(backfillLockStatusAfterContinuation('completed', null), 'completed');
    const fresh = new Date(now.getTime() - 60_000).toISOString();
    const stale = new Date(now.getTime() - 21 * 60_000).toISOString();
    assert.equal(backfillLockIsLive(fresh, now.getTime()), true);
    assert.equal(backfillLockIsLive(stale, now.getTime()), false);
    assert.equal(backfillLockIsLive(null, now.getTime()), false);
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
        functions: Record<string, { experimentalTriggers: { type: string; topic: string }[] }>;
    };
    const trigger = vercel.functions['app/api/queues/gsc-v2-backfill/route.ts'].experimentalTriggers[0];
    assert.equal(trigger.type, 'queue/v2beta');
    assert.equal(trigger.topic, BACKFILL_QUEUE_TOPIC);
});
