import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamSummary } from './team.ts';
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

const members = [
    { userId: 'user-carlos', displayName: 'Carlos Morones' },
    { userId: 'user-abel', displayName: 'Abel Miranda' },
];

test('every member gets a row, including one who logged nothing', () => {
    const summary = buildTeamSummary(
        [log({ id: 'a', date: '2026-08-24' })],
        '2026-08-23',
        members,
    );

    assert.deepEqual(summary.members.map(row => row.displayName), [
        'Abel Miranda',
        'Carlos Morones',
    ]);
    assert.equal(summary.members[0].totalMinutes, 0);
    assert.equal(summary.members[1].totalMinutes, 60);
});

test('member rows split tracked, budget, non-budget, and internal time', () => {
    const summary = buildTeamSummary(
        [
            log({ id: 'a', date: '2026-08-24', hours: 2 }),
            log({ id: 'b', date: '2026-08-25', hours: 1, countsTowardBudget: false }),
            log({ id: 'c', date: '2026-08-26', hours: 3, clientId: undefined, clientName: undefined }),
        ],
        '2026-08-23',
        members,
    );

    const carlos = summary.members.find(row => row.userId === 'user-carlos')!;
    assert.equal(carlos.totalMinutes, 360);
    assert.equal(carlos.budgetMinutes, 120);
    assert.equal(carlos.nonBudgetMinutes, 60);
    assert.equal(carlos.internalMinutes, 180);
});

test('member rows carry a seven-day distribution aligned to the week', () => {
    const summary = buildTeamSummary(
        [
            log({ id: 'a', date: '2026-08-23', hours: 1 }),
            log({ id: 'b', date: '2026-08-29', hours: 2 }),
        ],
        '2026-08-23',
        members,
    );

    const carlos = summary.members.find(row => row.userId === 'user-carlos')!;
    assert.deepEqual(carlos.dailyMinutes, [60, 0, 0, 0, 0, 0, 120]);
});

test('unmapped entries are counted per member and surfaced on the rail', () => {
    const summary = buildTeamSummary(
        [
            log({ id: 'orphan', date: '2026-08-24', userId: 'user-abel', source: 'basecamp', importStatus: 'needs_review' }),
            log({ id: 'ok', date: '2026-08-24' }),
        ],
        '2026-08-23',
        members,
    );

    const abel = summary.members.find(row => row.userId === 'user-abel')!;
    assert.equal(abel.unmappedCount, 1);
    assert.equal(summary.exceptions.length, 1);
    assert.equal(summary.exceptions[0].timeLogId, 'orphan');
});

test('an unmapped entry with no member yet still reaches the exception rail', () => {
    const summary = buildTeamSummary(
        [log({
            id: 'orphan', date: '2026-08-24', userId: '',
            source: 'basecamp', importStatus: 'needs_review',
        })],
        '2026-08-23',
        members,
    );

    assert.equal(summary.exceptions.length, 1);
    assert.equal(summary.totals.unmappedCount, 1);
});

test('team totals agree with the sum of the member rows', () => {
    const summary = buildTeamSummary(
        [
            log({ id: 'a', date: '2026-08-24', hours: 2 }),
            log({ id: 'b', date: '2026-08-25', hours: 3, userId: 'user-abel' }),
        ],
        '2026-08-23',
        members,
    );

    const summed = summary.members.reduce((total, row) => total + row.totalMinutes, 0);
    assert.equal(summary.totals.totalMinutes, 300);
    assert.equal(summed, summary.totals.totalMinutes);
});

test('voided and running entries stay out of every team number', () => {
    const summary = buildTeamSummary(
        [
            log({ id: 'live', date: '2026-08-24', hours: 1 }),
            log({ id: 'running', date: '2026-08-24', hours: 5, status: 'in_progress' }),
            log({ id: 'gone', date: '2026-08-24', hours: 5, importStatus: 'voided', voidedAt: '2026-08-24T00:00:00Z' }),
        ],
        '2026-08-23',
        members,
    );

    assert.equal(summary.totals.totalMinutes, 60);
});
