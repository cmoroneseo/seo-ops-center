import assert from 'node:assert/strict';
import test from 'node:test';

import {
    finalizeTaskCompletion,
    MIGRATED_BLOCKED_REASON,
    migrateLegacyTaskStatus,
    normalizeBlockedReason,
    statusAfterTimerStart,
    taskStatusColumns,
    taskStatusUpdate,
    taskStatusWrite,
} from './status.ts';

const NOW = '2026-10-19T18:00:00.000Z';
const UPDATED = '2026-10-02T15:00:00.000Z';
const APPROVED_AT = '2026-09-12T16:30:00.000Z';
const DONE_AT = '2026-08-01T12:00:00.000Z';

test('legacy statuses map to todo, in progress, and done', () => {
    assert.equal(migrateLegacyTaskStatus({ status: 'todo', now: NOW }).status, 'todo');
    assert.equal(migrateLegacyTaskStatus({ status: 'in_progress', now: NOW }).status, 'in_progress');
    assert.equal(migrateLegacyTaskStatus({ status: 'review', now: NOW }).status, 'in_progress');
    assert.equal(migrateLegacyTaskStatus({ status: 'approved', now: NOW }).status, 'done');
    assert.equal(migrateLegacyTaskStatus({ status: 'done', completedAt: DONE_AT, now: NOW }).status, 'done');
    assert.equal(migrateLegacyTaskStatus({ status: 'archived', now: NOW }).status, 'todo');
});

test('approved becomes done and keeps or backfills completed_at', () => {
    const kept = migrateLegacyTaskStatus({
        status: 'approved',
        completedAt: DONE_AT,
        statusHistory: [{ status: 'approved', at: APPROVED_AT }],
        createdAt: UPDATED,
        now: NOW,
    });
    assert.equal(kept.status, 'done');
    assert.equal(kept.completedAt, DONE_AT);
    assert.equal(kept.blockedReason, null);

    const fromHistory = migrateLegacyTaskStatus({
        status: 'approved',
        completedAt: null,
        statusHistory: [
            { status: 'review', at: '2026-09-01T00:00:00.000Z' },
            { status: 'approved', at: APPROVED_AT },
        ],
        createdAt: UPDATED,
        now: NOW,
    });
    assert.equal(fromHistory.completedAt, APPROVED_AT);

    const fromAnyHistory = migrateLegacyTaskStatus({
        status: 'approved',
        completedAt: null,
        statusHistory: [
            { status: 'in_progress', at: '2026-09-01T00:00:00.000Z' },
            { status: 'approved', at: 'not-a-date' },
        ],
        createdAt: UPDATED,
        now: NOW,
    });
    assert.equal(fromAnyHistory.completedAt, '2026-09-01T00:00:00.000Z');

    const fromCreated = migrateLegacyTaskStatus({
        status: 'approved',
        completedAt: null,
        statusHistory: [{ status: 'approved', at: 'not-a-date' }],
        createdAt: UPDATED,
        now: NOW,
    });
    assert.equal(fromCreated.completedAt, UPDATED);

    const fromNow = migrateLegacyTaskStatus({
        status: 'done',
        completedAt: null,
        statusHistory: [],
        createdAt: null,
        now: NOW,
    });
    assert.equal(fromNow.completedAt, NOW);
    assert.equal(fromNow.statusChanged, false);
});

test('blocked restores the previous open status and adds the migrated label', () => {
    const fromProgress = migrateLegacyTaskStatus({
        status: 'blocked',
        statusHistory: [
            { status: 'todo', at: '2026-01-01T00:00:00.000Z' },
            { status: 'in_progress', at: '2026-02-01T00:00:00.000Z' },
            { status: 'blocked', at: '2026-03-01T00:00:00.000Z' },
        ],
        now: NOW,
    });
    assert.equal(fromProgress.status, 'in_progress');
    assert.equal(fromProgress.blockedReason, MIGRATED_BLOCKED_REASON);
    assert.equal(fromProgress.completedAt, null);

    const fromReview = migrateLegacyTaskStatus({
        status: 'blocked',
        statusHistory: [
            { status: 'review', at: '2026-04-01T00:00:00.000Z' },
            { status: 'blocked', at: '2026-05-01T00:00:00.000Z' },
        ],
        now: NOW,
    });
    assert.equal(fromReview.status, 'in_progress');
    assert.equal(fromReview.blockedReason, MIGRATED_BLOCKED_REASON);

    const empty = migrateLegacyTaskStatus({ status: 'blocked', statusHistory: [], now: NOW });
    assert.equal(empty.status, 'todo');
    assert.equal(empty.blockedReason, MIGRATED_BLOCKED_REASON);

    const onlyBlocked = migrateLegacyTaskStatus({
        status: 'blocked',
        statusHistory: [{ status: 'blocked', at: '2026-05-01T00:00:00.000Z' }],
        now: NOW,
    });
    assert.equal(onlyBlocked.status, 'todo');

    const keptReason = migrateLegacyTaskStatus({
        status: 'blocked',
        blockedReason: 'Waiting on client logins',
        statusHistory: [{ status: 'todo', at: '2026-01-01T00:00:00.000Z' }],
        now: NOW,
    });
    assert.equal(keptReason.status, 'todo');
    assert.equal(keptReason.blockedReason, 'Waiting on client logins');
});

test('a blocked row whose previous status was done or approved does not keep the label', () => {
    const restored = migrateLegacyTaskStatus({
        status: 'blocked',
        statusHistory: [
            { status: 'approved', at: APPROVED_AT },
            { status: 'blocked', at: '2026-10-01T00:00:00.000Z' },
        ],
        createdAt: UPDATED,
        now: NOW,
    });
    assert.equal(restored.status, 'done');
    assert.equal(restored.completedAt, APPROVED_AT);
    assert.equal(restored.blockedReason, null);
});

test('review moving to in progress drops a stray completion stamp', () => {
    const moved = migrateLegacyTaskStatus({
        status: 'review',
        completedAt: DONE_AT,
        now: NOW,
    });
    assert.equal(moved.status, 'in_progress');
    assert.equal(moved.completedAt, null);
    assert.equal(moved.blockedReason, null);
});

test('a blocked reason is one required line and can be cleared', () => {
    const kept = normalizeBlockedReason('  Waiting on client logins  ');
    assert.equal(kept.ok, true);
    if (kept.ok) assert.equal(kept.reason, 'Waiting on client logins');
    assert.equal(normalizeBlockedReason('   ').ok, false);
    assert.equal(normalizeBlockedReason('line\nbreak').ok, false);
    assert.equal(normalizeBlockedReason('x'.repeat(201)).ok, false);
    assert.equal(normalizeBlockedReason('x'.repeat(200)).ok, true);
});

test('marking done stamps completed_at and clears the blocked label; unchecking clears the stamp', () => {
    const done = taskStatusColumns({ status: 'done', now: NOW });
    assert.deepEqual(done, { status: 'done', completed_at: NOW, blocked_reason: null });

    const kept = taskStatusColumns({ status: 'done', now: NOW, completedAt: DONE_AT });
    assert.equal(kept.completed_at, DONE_AT);
    assert.equal(kept.blocked_reason, null);

    const blankStamp = taskStatusColumns({ status: 'done', now: NOW, completedAt: '' });
    assert.equal(blankStamp.completed_at, NOW);

    const reopened = taskStatusColumns({ status: 'todo', now: NOW, completedAt: DONE_AT });
    assert.deepEqual(reopened, { status: 'todo', completed_at: null });
    assert.equal('blocked_reason' in reopened, false);

    const started = taskStatusColumns({ status: 'in_progress', now: NOW });
    assert.equal(started.completed_at, null);
    assert.equal('blocked_reason' in started, false);
});

test('a chosen completion day is stored and recorded, and a future day is refused', () => {
    const backdated = taskStatusWrite({
        status: 'done',
        now: NOW,
        completedAt: DONE_AT,
        by: 'carlos',
    });
    assert.equal(backdated.ok, true);
    if (!backdated.ok) return;
    assert.equal(backdated.columns.completed_at, DONE_AT);
    assert.deepEqual(backdated.historyEntry, { status: 'done', at: DONE_AT, by: 'carlos' });

    const omitted = taskStatusWrite({ status: 'done', now: NOW });
    assert.equal(omitted.ok, true);
    if (omitted.ok) assert.equal(omitted.historyEntry.at, NOW);

    const future = taskStatusWrite({
        status: 'done',
        now: NOW,
        completedAt: '2026-11-01T12:00:00.000Z',
    });
    assert.equal(future.ok, false);

    const reopened = taskStatusWrite({ status: 'todo', now: NOW, completedAt: DONE_AT });
    assert.equal(reopened.ok, true);
    if (!reopened.ok) return;
    assert.equal(reopened.columns.completed_at, null);
    assert.equal(reopened.historyEntry.at, NOW);
});

test('finalizing a timer does not replace a completion date that was already chosen', () => {
    const kept = finalizeTaskCompletion({
        status: 'done',
        existingCompletedAt: DONE_AT,
        finalizedAt: NOW,
    });
    assert.deepEqual(kept, { ok: true, unchanged: true });

    const supplied = finalizeTaskCompletion({
        status: 'todo',
        finalizedAt: NOW,
        suppliedCompletedAt: DONE_AT,
        by: 'carlos',
    });
    assert.equal(supplied.ok, true);
    if (!supplied.ok || supplied.unchanged) return;
    assert.equal(supplied.columns.completed_at, DONE_AT);
    assert.equal(supplied.historyEntry?.at, DONE_AT);

    const stamped = finalizeTaskCompletion({ status: 'in_progress', finalizedAt: NOW });
    assert.equal(stamped.ok, true);
    if (!stamped.ok || stamped.unchanged) return;
    assert.equal(stamped.columns.completed_at, NOW);

    const future = finalizeTaskCompletion({
        status: 'todo',
        finalizedAt: NOW,
        suppliedCompletedAt: '2026-12-01T00:00:00.000Z',
    });
    assert.equal(future.ok, false);
});

test('resaving a done task does not replace its completion date', () => {
    const kept = taskStatusUpdate({
        previousStatus: 'done',
        status: 'done',
        now: NOW,
    });
    assert.deepEqual(kept, { ok: true, changed: false });

    const backdated = taskStatusUpdate({
        previousStatus: 'todo',
        status: 'done',
        now: NOW,
        completedAt: DONE_AT,
        by: 'carlos',
    });
    assert.equal(backdated.ok, true);
    if (!backdated.ok || !backdated.changed) return;
    assert.equal(backdated.columns.completed_at, DONE_AT);
    assert.equal(backdated.historyEntry.at, DONE_AT);

    const reopened = taskStatusUpdate({
        previousStatus: 'done',
        status: 'todo',
        now: NOW,
        completedAt: DONE_AT,
    });
    assert.equal(reopened.ok, true);
    if (!reopened.ok || !reopened.changed) return;
    assert.equal(reopened.columns.completed_at, null);
    assert.equal(reopened.historyEntry.at, NOW);
});

test('starting a timer moves a to-do task to in progress and leaves the others', () => {
    assert.equal(statusAfterTimerStart('todo'), 'in_progress');
    assert.equal(statusAfterTimerStart('in_progress'), 'in_progress');
    assert.equal(statusAfterTimerStart('done'), 'done');
    assert.equal(statusAfterTimerStart('review'), 'in_progress');
});
