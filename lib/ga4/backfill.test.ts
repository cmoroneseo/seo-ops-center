import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GA4_BACKFILL_MONTHS, GA4_CRON_SCHEDULE, GA4_QUEUE_TOPIC, backfillMonthStarts, ga4CronStartSend,
    monthRequestRange, nextBackfillMonth, parseGa4QueueMessage,
} from './backfill.ts';

const NOW = new Date('2026-10-15T11:00:00Z');
const RUN = '11111111-1111-4111-8111-111111111111';

test('backfill is sixteen calendar months, one month per step, and a rerun continues at the cursor', () => {
    const months = backfillMonthStarts(NOW);
    assert.equal(GA4_BACKFILL_MONTHS, 16);
    assert.equal(months.length, 16);
    assert.equal(months[0], '2026-10-01');
    assert.equal(months[15], '2025-07-01');
    assert.equal(nextBackfillMonth(null, NOW), '2026-10-01');
    assert.deepEqual(monthRequestRange('2026-10-01', NOW), { start: '2026-10-01', end: '2026-10-14' });
    assert.deepEqual(monthRequestRange('2026-09-01', NOW), { start: '2026-09-01', end: '2026-09-30' });
    assert.equal(nextBackfillMonth('2026-10-01', NOW), '2026-09-01');
    assert.equal(nextBackfillMonth('2025-07-01', NOW), null);
    assert.equal(monthRequestRange('2026-10-01', new Date('2026-10-01T12:00:00Z')), null);
});

test('queue messages are one chain per day and ignore a payload that is not a run', () => {
    assert.equal(GA4_QUEUE_TOPIC, 'ga4-backfill');
    assert.equal(GA4_CRON_SCHEDULE, '0 11 * * *');
    const first = ga4CronStartSend(NOW, RUN, 'backfill');
    const retry = ga4CronStartSend(new Date('2026-10-15T18:00:00Z'), '22222222-2222-4222-8222-222222222222', 'backfill');
    assert.equal(first?.idempotencyKey, retry?.idempotencyKey);
    assert.equal(first?.kind, 'backfill');
    assert.equal(parseGa4QueueMessage({ runId: RUN, chain: 1, kind: 'daily' })?.kind, 'daily');
    assert.equal(parseGa4QueueMessage({ runId: 'nope', chain: 1, kind: 'daily' }), null);
    assert.equal(parseGa4QueueMessage({ runId: RUN, chain: 1 }), null);
});
