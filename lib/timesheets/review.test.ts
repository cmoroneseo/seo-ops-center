import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildClientMonthSnapshot,
    detectPostApprovalChanges,
    monthOf,
} from './review.ts';
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

test('monthOf reads the YYYY-MM bucket from a local date', () => {
    assert.equal(monthOf('2026-08-24'), '2026-08');
    assert.equal(monthOf('2026-12-01'), '2026-12');
});

test('snapshot sums eligible and non-budget minutes for the month', () => {
    const snapshot = buildClientMonthSnapshot(
        [
            log({ id: 'a', date: '2026-08-03', hours: 2 }),
            log({ id: 'b', date: '2026-08-20', hours: 1.5 }),
            log({ id: 'c', date: '2026-08-21', hours: 1, countsTowardBudget: false }),
        ],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.equal(snapshot.eligibleMinutes, 210);
    assert.equal(snapshot.nonBudgetMinutes, 60);
    assert.equal(snapshot.budgetMinutes, 600);
    assert.equal(snapshot.entries.length, 3);
});

test('snapshot ignores other clients and other months', () => {
    const snapshot = buildClientMonthSnapshot(
        [
            log({ id: 'keep', date: '2026-08-10' }),
            log({ id: 'other-month', date: '2026-07-31' }),
            log({ id: 'other-client', date: '2026-08-10', clientId: 'client-b' }),
        ],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(snapshot.entries.map(entry => entry.timeLogId), ['keep']);
});

test('only mapped, non-voided, finalized rows qualify', () => {
    const snapshot = buildClientMonthSnapshot(
        [
            log({ id: 'ok', date: '2026-08-10' }),
            log({ id: 'running', date: '2026-08-11', status: 'in_progress' }),
            log({ id: 'voided', date: '2026-08-12', importStatus: 'voided', voidedAt: '2026-08-12T00:00:00Z' }),
            log({ id: 'review', date: '2026-08-13', importStatus: 'needs_review' }),
        ],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(snapshot.entries.map(entry => entry.timeLogId), ['ok']);
});

test('unmapped rows in the month block approval', () => {
    const snapshot = buildClientMonthSnapshot(
        [
            log({ id: 'ok', date: '2026-08-10' }),
            log({ id: 'orphan', date: '2026-08-11', source: 'basecamp', importStatus: 'needs_review' }),
        ],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.equal(snapshot.unmappedCount, 1);
    assert.equal(snapshot.canApprove, false);
    assert.deepEqual(snapshot.blockers, ['unmapped_entries']);
});

test('a clean month with no unmapped rows can be approved', () => {
    const snapshot = buildClientMonthSnapshot(
        [log({ id: 'ok', date: '2026-08-10' })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.equal(snapshot.canApprove, true);
    assert.deepEqual(snapshot.blockers, []);
});

test('over-budget months are flagged but still approvable with a note', () => {
    const snapshot = buildClientMonthSnapshot(
        [log({ id: 'ok', date: '2026-08-10', hours: 12 })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.equal(snapshot.overBudget, true);
    assert.equal(snapshot.requiresNote, true);
    assert.equal(snapshot.canApprove, true);
    assert.equal(snapshot.remainingMinutes, -120);
});

test('an under-budget month needs no note', () => {
    const snapshot = buildClientMonthSnapshot(
        [log({ id: 'ok', date: '2026-08-10', hours: 2 })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.equal(snapshot.overBudget, false);
    assert.equal(snapshot.requiresNote, false);
    assert.equal(snapshot.remainingMinutes, 480);
});

test('snapshot records exact included ids and minutes per entry', () => {
    const snapshot = buildClientMonthSnapshot(
        [
            log({ id: 'a', date: '2026-08-10', hours: 2 }),
            log({ id: 'b', date: '2026-08-11', hours: 0.5, countsTowardBudget: false }),
        ],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(snapshot.entries, [
        { timeLogId: 'a', includedMinutes: 120 },
        { timeLogId: 'b', includedMinutes: 30 },
    ]);
});

test('snapshot breaks totals down per teammate', () => {
    const snapshot = buildClientMonthSnapshot(
        [
            log({ id: 'a', date: '2026-08-10', hours: 2 }),
            log({ id: 'b', date: '2026-08-11', hours: 3, userId: 'user-abel', source: 'basecamp' }),
            log({ id: 'c', date: '2026-08-12', hours: 1, userId: 'user-abel', countsTowardBudget: false }),
        ],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(snapshot.members, [
        { userId: 'user-abel', totalMinutes: 240, eligibleMinutes: 180, nonBudgetMinutes: 60 },
        { userId: 'user-carlos', totalMinutes: 120, eligibleMinutes: 120, nonBudgetMinutes: 0 },
    ]);
});

test('an approved snapshot is never recomputed from current totals', () => {
    const approved = buildClientMonthSnapshot(
        [log({ id: 'a', date: '2026-08-10', hours: 2 })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    detectPostApprovalChanges(approved, [log({ id: 'a', date: '2026-08-10', hours: 9 })]);

    assert.equal(approved.eligibleMinutes, 120);
    assert.deepEqual(approved.entries, [{ timeLogId: 'a', includedMinutes: 120 }]);
});

test('no drift is reported when the ledger still matches the snapshot', () => {
    const logs = [log({ id: 'a', date: '2026-08-10', hours: 2 })];
    const approved = buildClientMonthSnapshot(logs, {
        clientId: 'client-a', month: '2026-08', budgetMinutes: 600,
    });

    assert.deepEqual(detectPostApprovalChanges(approved, logs), []);
});

test('an edited included entry is reported as a minutes change', () => {
    const approved = buildClientMonthSnapshot(
        [log({ id: 'a', date: '2026-08-10', hours: 2 })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(
        detectPostApprovalChanges(approved, [log({ id: 'a', date: '2026-08-10', hours: 3 })]),
        [{ kind: 'minutes_changed', timeLogId: 'a', approvedMinutes: 120, currentMinutes: 180 }],
    );
});

test('a voided included entry is reported as removed', () => {
    const approved = buildClientMonthSnapshot(
        [log({ id: 'a', date: '2026-08-10', hours: 2 })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(
        detectPostApprovalChanges(approved, [
            log({ id: 'a', date: '2026-08-10', hours: 2, importStatus: 'voided', voidedAt: '2026-09-01T00:00:00Z' }),
        ]),
        [{ kind: 'removed', timeLogId: 'a', approvedMinutes: 120, currentMinutes: 0 }],
    );
});

test('a deleted included entry is reported as removed', () => {
    const approved = buildClientMonthSnapshot(
        [log({ id: 'a', date: '2026-08-10', hours: 2 })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(
        detectPostApprovalChanges(approved, []),
        [{ kind: 'removed', timeLogId: 'a', approvedMinutes: 120, currentMinutes: 0 }],
    );
});

test('a late import into an approved month is reported as an addition', () => {
    const approved = buildClientMonthSnapshot(
        [log({ id: 'a', date: '2026-08-10', hours: 2 })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(
        detectPostApprovalChanges(approved, [
            log({ id: 'a', date: '2026-08-10', hours: 2 }),
            log({ id: 'late', date: '2026-08-28', hours: 1, source: 'basecamp' }),
        ]),
        [{ kind: 'added', timeLogId: 'late', approvedMinutes: 0, currentMinutes: 60 }],
    );
});

test('changes outside the approved client month are not drift', () => {
    const approved = buildClientMonthSnapshot(
        [log({ id: 'a', date: '2026-08-10', hours: 2 })],
        { clientId: 'client-a', month: '2026-08', budgetMinutes: 600 },
    );

    assert.deepEqual(
        detectPostApprovalChanges(approved, [
            log({ id: 'a', date: '2026-08-10', hours: 2 }),
            log({ id: 'sept', date: '2026-09-02', hours: 4 }),
            log({ id: 'other', date: '2026-08-15', hours: 4, clientId: 'client-b' }),
        ]),
        [],
    );
});
