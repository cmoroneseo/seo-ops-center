import test from 'node:test';
import assert from 'node:assert/strict';
import { actualAttemptToItems, loggedWindow, shouldRenderForecast } from './actual-items.ts';
import type { Task, TimerAttempt } from '../types.ts';

/**
 * Time logged by hand used to render nothing at all, because planner evidence
 * was built purely from timer segments. A day whose only mark was a task's
 * forecast block therefore lost its entire visual record when that block was
 * dragged to another day — the hours survived in the ledger, but the calendar
 * showed the work had never happened.
 */

const NOW = new Date('2026-08-27T12:00:00Z');

function attempt(overrides: Partial<TimerAttempt> = {}): TimerAttempt {
    return {
        id: 'log-1',
        organizationId: 'org-a',
        clientId: 'client-a',
        taskId: 'task-1',
        userId: 'user-1',
        date: '2026-08-26',
        hours: 2.75,
        description: 'Van Electrical blog post',
        status: 'logged',
        segments: [],
        plannedStartsAt: '2026-08-26T22:15:00.000Z',
        plannedMinutes: 165,
        ...overrides,
    } as TimerAttempt;
}

test('hand-logged time appears on the calendar', () => {
    const items = actualAttemptToItems(attempt(), NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0].source, 'actual_time');
    assert.equal(items[0].startsAt, '2026-08-26T22:15:00.000Z');
});

test('the block is as long as the hours logged, not the hours planned', () => {
    // Logging 2h against a 2h45m block must draw two hours. A block that
    // renders its planned length would overstate the day's work.
    const items = actualAttemptToItems(attempt({ hours: 2 }), NOW);
    assert.equal(items[0].endsAt, '2026-08-27T00:15:00.000Z');
});

test('a logged block cannot be dragged', () => {
    // It is a record of what happened, not a plan.
    assert.equal(actualAttemptToItems(attempt(), NOW)[0].draggable, false);
});

test('a log with no planned window still renders nothing', () => {
    // Nothing places it on the grid; inventing a position would be a guess
    // about when the work happened.
    assert.deepEqual(actualAttemptToItems(attempt({ plannedStartsAt: undefined }), NOW), []);
    assert.equal(loggedWindow(attempt({ plannedStartsAt: undefined })), null);
});

test('a zero-hour log claims no space', () => {
    assert.equal(loggedWindow(attempt({ hours: 0 })), null);
});

test('a corrupt planned timestamp is refused rather than rendered at the epoch', () => {
    assert.equal(loggedWindow(attempt({ plannedStartsAt: 'not-a-date' })), null);
});

const task = {
    id: 'task-1',
    startDate: '2026-08-26T22:15:00.000Z',
    scheduledMinutes: 165,
} as Task;

test('a worked block replaces its forecast rather than doubling it', () => {
    // Otherwise Wednesday shows both "planned 3:15-6:00" and "logged
    // 3:15-6:00" — the same session drawn twice.
    assert.equal(shouldRenderForecast(task, [attempt()]), false);
});

test('rescheduling to another day leaves the worked block and forecasts anew', () => {
    // The point of the whole change: Wednesday keeps its evidence while
    // Thursday gets a fresh plan.
    const moved = { ...task, startDate: '2026-08-27T22:15:00.000Z' } as Task;
    assert.equal(shouldRenderForecast(moved, [attempt()]), true);
    assert.equal(actualAttemptToItems(attempt(), NOW)[0].startsAt, '2026-08-26T22:15:00.000Z');
});
