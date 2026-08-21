import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TimerAttempt } from './types.ts';
import type { TimerStateResponse } from './timer/contracts.ts';
import * as timerUi from './timer-ui.ts';

function attempt(overrides: Partial<TimerAttempt> = {}): TimerAttempt {
    return {
        id: 'attempt-1', organizationId: 'org-1', userId: 'user-1', date: '2026-08-20', hours: 0,
        description: '', billable: true, countsTowardBudget: true, status: 'in_progress', elapsedSeconds: 0,
        sessionNotes: [], segments: [], ...overrides,
    };
}

test('attempt duration includes its legacy baseline and every closed or open segment', () => {
    const value = attempt({
        elapsedSeconds: 120,
        segments: [
            { id: 'closed-1', timeLogId: 'attempt-1', organizationId: 'org-1', userId: 'user-1', startedAt: '2026-08-20T10:00:00.000Z', endedAt: '2026-08-20T10:10:00.000Z' },
            { id: 'closed-2', timeLogId: 'attempt-1', organizationId: 'org-1', userId: 'user-1', startedAt: '2026-08-20T11:00:00.000Z', endedAt: '2026-08-20T11:05:00.000Z' },
            { id: 'open', timeLogId: 'attempt-1', organizationId: 'org-1', userId: 'user-1', startedAt: '2026-08-20T12:00:00.000Z' },
        ],
    });

    assert.equal(timerUi.totalAttemptActiveSeconds(value, new Date('2026-08-20T12:10:00.000Z')), 1_620);
});

test('canonical response application keeps one running attempt and sorts paused work by last closed segment', () => {
    const newest = attempt({ id: 'newest', segments: [{ id: 'new', timeLogId: 'newest', organizationId: 'org-1', userId: 'user-1', startedAt: '2026-08-20T11:00:00.000Z', endedAt: '2026-08-20T11:30:00.000Z' }] });
    const oldest = attempt({ id: 'oldest', segments: [{ id: 'old', timeLogId: 'oldest', organizationId: 'org-1', userId: 'user-1', startedAt: '2026-08-20T09:00:00.000Z', endedAt: '2026-08-20T09:30:00.000Z' }] });
    const running = attempt({ id: 'running', timerStartedAt: '2026-08-20T12:00:00.000Z' });
    const state: TimerStateResponse = { running, paused: [oldest, newest] };

    assert.deepEqual(timerUi.timerUiStateFromResponse(state), { runningTimer: running, pausedTimers: [newest, oldest] });
});

test('declining a switch leaves server state untouched', async () => {
    const calls: unknown[] = [];
    const switched = await timerUi.confirmAndSwitchTimer({
        running: attempt({ id: 'running', taskTitle: 'Current task' }),
        target: { taskId: 'next-task', title: 'Next task' },
        confirm: () => false,
        mutate: async request => { calls.push(request); },
    });

    assert.equal(switched, false);
    assert.deepEqual(calls, []);
});

test('accepted switches issue one canonical switch mutation', async () => {
    const calls: unknown[] = [];
    const switched = await timerUi.confirmAndSwitchTimer({
        running: attempt({ id: 'running', taskTitle: 'Current task' }),
        target: { timeLogId: 'paused-2', title: 'Paused task' },
        confirm: () => true,
        mutate: async request => { calls.push(request); },
    });

    assert.equal(switched, true);
    assert.deepEqual(calls, [{ action: 'switch', fromTimeLogId: 'running', toTimeLogId: 'paused-2' }]);
});

test('finalization preserves the attempt budget setting until an explicit override exists', () => {
    const request = timerUi.finalizeTimerAttempt(attempt({ countsTowardBudget: false }), {
        description: 'Reviewed work', billable: true, syncToBasecamp: false, markTaskComplete: false, timeZone: 'UTC',
    });

    assert.equal(request.countsTowardBudget, false);
});

test('quick start requires both a selected client and a selected task', () => {
    assert.equal(timerUi.canStartTaskTimer('client-1', ''), false);
    assert.equal(timerUi.canStartTaskTimer('', 'task-1'), false);
    assert.equal(timerUi.canStartTaskTimer('client-1', 'task-1'), true);
});

test('a review sheet resolves its attempt by identity from the latest canonical state', () => {
    const reviewed = attempt({
        id: 'reviewing',
        reviewingAt: '2026-08-20T12:00:00.000Z',
        sessionNotes: [{ id: 'note-1', text: 'Saved note', createdAt: '2026-08-20T12:01:00.000Z' }],
    });
    const state = timerUi.timerUiStateFromResponse({ running: null, paused: [reviewed] });

    assert.equal(timerUi.findTimerAttempt(state, 'reviewing')?.sessionNotes[0]?.text, 'Saved note');
});
