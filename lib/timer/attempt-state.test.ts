import assert from 'node:assert/strict';
import test from 'node:test';

import type { TimerAttempt } from '../types';
import {
    GLOBAL_TIMER_LABEL,
    RESUMED_OPEN_TIMER_MESSAGE,
    TIMER_IN_REVIEW_MESSAGE,
    formatAttemptClock,
    isShortPausedAttempt,
    midnightSplitLabel,
    openTimerRows,
    overnightSplitSentence,
    timerConflictMessage,
} from './attempt-state.ts';

function attempt(overrides: Partial<TimerAttempt> = {}): TimerAttempt {
    return {
        id: 'attempt-1',
        organizationId: 'org-1',
        userId: 'user-1',
        date: '2026-10-21',
        hours: 0,
        description: '',
        billable: true,
        countsTowardBudget: true,
        status: 'in_progress',
        elapsedSeconds: 0,
        sessionNotes: [],
        segments: [],
        source: 'seo_pm',
        importStatus: 'mapped',
        ...overrides,
    };
}

test('a paused entry under a minute is flagged and a full minute is not', () => {
    assert.equal(isShortPausedAttempt(0), true);
    assert.equal(isShortPausedAttempt(7), true);
    assert.equal(isShortPausedAttempt(59), true);
    assert.equal(isShortPausedAttempt(60), false);
    assert.equal(isShortPausedAttempt(Number.NaN), false);
});

test('a second start during review gets a fixed message and other conflicts stay generic', () => {
    assert.equal(
        timerConflictMessage(Object.assign(new Error('time attempt is in review'), { code: '55000' })),
        TIMER_IN_REVIEW_MESSAGE,
    );
    assert.equal(
        timerConflictMessage(Object.assign(new Error('switch retry conflicts with advanced target state'), { code: '55000' })),
        null,
    );
    assert.equal(
        timerConflictMessage(Object.assign(new Error('time attempt is in review'), { code: '23505' })),
        null,
    );
    assert.equal(TIMER_IN_REVIEW_MESSAGE.includes('time attempt is in review'), false);
});

test('open timer rows keep this client and name the phase', () => {
    const running = attempt({
        id: 'run',
        clientId: 'client-a',
        taskId: 'task-1',
        taskTitle: 'Roadmap',
        timerStartedAt: '2026-10-21T18:00:00.000Z',
    });
    const paused = attempt({
        id: 'pause',
        clientId: 'client-a',
        taskId: 'task-2',
        taskTitle: 'Citations',
        elapsedSeconds: 26 * 60,
    });
    const other = attempt({
        id: 'other',
        clientId: 'client-b',
        taskTitle: 'Elsewhere',
        elapsedSeconds: 90,
    });
    const reviewing = attempt({
        id: 'review',
        clientId: 'client-a',
        taskTitle: 'Audit',
        reviewingAt: '2026-10-21T19:00:00.000Z',
        elapsedSeconds: 120,
    });

    assert.deepEqual(
        openTimerRows(running, [paused, other, reviewing], item => item.elapsedSeconds + (item.id === 'run' ? 90 : 0), 'client-a'),
        [
            { attemptId: 'run', taskId: 'task-1', title: 'Roadmap', phase: 'running', seconds: 90 },
            { attemptId: 'pause', taskId: 'task-2', title: 'Citations', phase: 'paused', seconds: 26 * 60 },
            { attemptId: 'review', taskId: null, title: 'Audit', phase: 'reviewing', seconds: 120 },
        ],
    );
    assert.equal(formatAttemptClock(26 * 60 + 39), '26:39');
    assert.equal(GLOBAL_TIMER_LABEL, 'Time a task');
    assert.equal(RESUMED_OPEN_TIMER_MESSAGE.includes('Resumed'), true);
});

test('a midnight split names the other day instead of looking like a shorter entry', () => {
    const first = {
        id: 'day-1',
        operationId: 'op-1',
        date: '2026-10-20',
        hours: 0.03,
        elapsedSeconds: 95,
        status: 'logged',
    };
    const second = {
        id: 'day-2',
        operationId: 'op-1',
        date: '2026-10-21',
        hours: 0.42,
        elapsedSeconds: 1504,
        status: 'logged',
    };
    assert.equal(
        midnightSplitLabel(second, [first, second]),
        'Split at midnight from one timer. Also 2m on 2026-10-20.',
    );
    assert.equal(
        midnightSplitLabel(first, [first, second]),
        'Split at midnight from one timer. Also 25m on 2026-10-21.',
    );
    assert.equal(midnightSplitLabel(second, [second]), null);
    assert.equal(midnightSplitLabel({ ...second, operationId: undefined }, [first, second]), null);
    assert.equal(midnightSplitLabel({ ...second, status: 'in_progress' }, [first, second]), null);
});

test('the log confirmation says when one timer becomes two dated entries', () => {
    assert.equal(overnightSplitSentence([
        { localDate: '2026-10-21', activeSeconds: 1504 },
    ]), null);
    assert.equal(overnightSplitSentence([
        { localDate: '2026-10-21', activeSeconds: 1504 },
        { localDate: '2026-10-20', activeSeconds: 95 },
    ]), 'Logged as separate entries because this timer crossed midnight: 1m 35s on 2026-10-20 and 25m 4s on 2026-10-21.');
});
