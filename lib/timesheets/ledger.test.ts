import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyLedger, weekStartFor, weekDays } from './ledger.ts';
import type { LedgerLog } from './ledger.ts';

function log(overrides: Partial<LedgerLog> & { id: string; date: string }): LedgerLog {
    return {
        organizationId: 'org-1',
        clientId: 'client-a',
        clientName: 'Client A',
        taskId: 'task-1',
        taskTitle: 'On-page fixes',
        userId: 'user-carlos',
        hours: 1,
        description: '',
        countsTowardBudget: true,
        status: 'logged',
        source: 'seo_pm',
        importStatus: 'mapped',
        ...overrides,
    };
}

test('weekStartFor snaps any day to its containing Sunday', () => {
    assert.equal(weekStartFor('2026-08-24'), '2026-08-23'); // Monday -> Sunday
    assert.equal(weekStartFor('2026-08-23'), '2026-08-23'); // Sunday stays
    assert.equal(weekStartFor('2026-08-29'), '2026-08-23'); // Saturday
});

test('weekDays returns seven consecutive local dates', () => {
    assert.deepEqual(weekDays('2026-08-23'), [
        '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26',
        '2026-08-27', '2026-08-28', '2026-08-29',
    ]);
});

test('weekDays crosses a month boundary without drifting', () => {
    assert.deepEqual(weekDays('2026-08-30'), [
        '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
        '2026-09-03', '2026-09-04', '2026-09-05',
    ]);
});

test('same-day entries on one task collapse into a single row cell', () => {
    const ledger = buildWeeklyLedger(
        [
            log({ id: 'a', date: '2026-08-24', hours: 1.5 }),
            log({ id: 'b', date: '2026-08-24', hours: 0.5 }),
        ],
        '2026-08-23',
    );

    assert.equal(ledger.clients.length, 1);
    const row = ledger.clients[0].rows[0];
    assert.equal(row.dailyMinutes[1], 120);
    assert.equal(row.totalMinutes, 120);
    assert.deepEqual(row.entryIds, ['a', 'b']);
});

test('rows group by client then task, with per-client and grand totals', () => {
    const ledger = buildWeeklyLedger(
        [
            log({ id: 'a', date: '2026-08-24', hours: 1 }),
            log({ id: 'b', date: '2026-08-25', taskId: 'task-2', taskTitle: 'Content brief', hours: 2 }),
            log({
                id: 'c', date: '2026-08-26', clientId: 'client-b', clientName: 'Client B',
                taskId: 'task-3', taskTitle: 'Audit', hours: 3,
            }),
        ],
        '2026-08-23',
    );

    assert.deepEqual(ledger.clients.map(group => group.clientName), ['Client A', 'Client B']);
    assert.equal(ledger.clients[0].rows.length, 2);
    assert.equal(ledger.clients[0].totalMinutes, 180);
    assert.equal(ledger.clients[1].totalMinutes, 180);
    assert.equal(ledger.totals.totalMinutes, 360);
});

test('daily totals line up with the seven week columns', () => {
    const ledger = buildWeeklyLedger(
        [
            log({ id: 'a', date: '2026-08-23', hours: 1 }),
            log({ id: 'b', date: '2026-08-29', hours: 2 }),
        ],
        '2026-08-23',
    );

    assert.deepEqual(ledger.totals.dailyMinutes, [60, 0, 0, 0, 0, 0, 120]);
});

test('entries outside the week are excluded', () => {
    const ledger = buildWeeklyLedger(
        [
            log({ id: 'inside', date: '2026-08-23' }),
            log({ id: 'before', date: '2026-08-22' }),
            log({ id: 'after', date: '2026-08-30' }),
        ],
        '2026-08-23',
    );

    assert.equal(ledger.totals.totalMinutes, 60);
    assert.deepEqual(ledger.clients[0].rows[0].entryIds, ['inside']);
});

test('budget-eligible, non-budget, and internal time are distinguished', () => {
    const ledger = buildWeeklyLedger(
        [
            log({ id: 'budget', date: '2026-08-24', hours: 2 }),
            log({ id: 'meeting', date: '2026-08-24', hours: 1, countsTowardBudget: false }),
            log({
                id: 'internal', date: '2026-08-24', hours: 3,
                clientId: undefined, clientName: undefined, countsTowardBudget: false,
            }),
        ],
        '2026-08-23',
    );

    assert.equal(ledger.totals.budgetMinutes, 120);
    assert.equal(ledger.totals.nonBudgetMinutes, 60);
    assert.equal(ledger.totals.internalMinutes, 180);
    assert.equal(ledger.totals.totalMinutes, 360);
});

test('internal time groups under an explicit internal bucket, never a guessed client', () => {
    const ledger = buildWeeklyLedger(
        [log({ id: 'i', date: '2026-08-24', clientId: undefined, clientName: undefined })],
        '2026-08-23',
    );

    assert.equal(ledger.clients[0].clientId, null);
    assert.equal(ledger.clients[0].isInternal, true);
});

test('source identity is preserved per row without duplicating the entry', () => {
    const ledger = buildWeeklyLedger(
        [
            log({ id: 'native', date: '2026-08-24' }),
            log({ id: 'imported', date: '2026-08-25', source: 'basecamp' }),
        ],
        '2026-08-23',
    );

    const row = ledger.clients[0].rows[0];
    assert.deepEqual([...row.sources].sort(), ['basecamp', 'seo_pm']);
    assert.equal(row.entryIds.length, 2);
    assert.equal(ledger.totals.totalMinutes, 120);
});

test('unmapped imported rows are counted and surfaced as exceptions', () => {
    const ledger = buildWeeklyLedger(
        [
            log({
                id: 'orphan', date: '2026-08-24', source: 'basecamp', importStatus: 'needs_context',
                clientId: undefined, clientName: undefined, taskId: undefined, taskTitle: undefined,
            }),
            log({ id: 'ok', date: '2026-08-24' }),
        ],
        '2026-08-23',
    );

    assert.equal(ledger.totals.unmappedCount, 1);
    assert.equal(ledger.exceptions.length, 1);
    assert.equal(ledger.exceptions[0].kind, 'unmapped_import');
    assert.equal(ledger.exceptions[0].timeLogId, 'orphan');
});

test('unmapped rows sit in a review bucket, not under a guessed client', () => {
    const ledger = buildWeeklyLedger(
        [log({ id: 'orphan', date: '2026-08-24', source: 'basecamp', importStatus: 'needs_context' })],
        '2026-08-23',
    );

    const group = ledger.clients[0];
    assert.equal(group.needsReview, true);
    assert.equal(group.clientId, null);
});

test('voided imports are excluded from every total', () => {
    const ledger = buildWeeklyLedger(
        [
            log({
                id: 'gone', date: '2026-08-24', hours: 5, source: 'basecamp',
                importStatus: 'voided', voidedAt: '2026-08-24T10:00:00Z',
            }),
            log({ id: 'live', date: '2026-08-24', hours: 1 }),
        ],
        '2026-08-23',
    );

    assert.equal(ledger.totals.totalMinutes, 60);
    assert.equal(ledger.totals.unmappedCount, 0);
});

test('running timers are excluded from the ledger', () => {
    const ledger = buildWeeklyLedger(
        [log({ id: 'running', date: '2026-08-24', hours: 0, status: 'in_progress' })],
        '2026-08-23',
    );

    assert.equal(ledger.totals.totalMinutes, 0);
    assert.equal(ledger.clients.length, 0);
});

test('a ledger for a week with no entries is empty but well formed', () => {
    const ledger = buildWeeklyLedger([], '2026-08-23');

    assert.deepEqual(ledger.days.length, 7);
    assert.deepEqual(ledger.totals.dailyMinutes, [0, 0, 0, 0, 0, 0, 0]);
    assert.equal(ledger.totals.totalMinutes, 0);
    assert.deepEqual(ledger.clients, []);
});

test('minutes round half-hour and quarter-hour values exactly', () => {
    const ledger = buildWeeklyLedger(
        [
            log({ id: 'a', date: '2026-08-24', hours: 0.25 }),
            log({ id: 'b', date: '2026-08-25', hours: 1.75 }),
        ],
        '2026-08-23',
    );

    assert.equal(ledger.totals.totalMinutes, 120);
});

test('a user filter narrows the ledger to one member', () => {
    const ledger = buildWeeklyLedger(
        [
            log({ id: 'carlos', date: '2026-08-24' }),
            log({ id: 'abel', date: '2026-08-24', userId: 'user-abel' }),
        ],
        '2026-08-23',
        { userId: 'user-abel' },
    );

    assert.equal(ledger.totals.totalMinutes, 60);
    assert.deepEqual(ledger.clients[0].rows[0].entryIds, ['abel']);
});
