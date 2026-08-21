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

function segment(id: string, startedAt: string, endedAt?: string) {
    return { id, timeLogId: 'attempt-1', organizationId: 'org-1', userId: 'user-1', startedAt, endedAt };
}

test('client task review defaults to SEO-hour budget without preselecting completion', () => {
    const defaults = timerUi.stopReviewDefaults(attempt({ clientId: 'client-1', taskId: 'task-1' }));

    assert.deepEqual(defaults, {
        billable: true,
        countsTowardBudget: true,
        markTaskComplete: false,
        canMarkTaskComplete: true,
    });
});

test('an explicit non-budget attempt keeps its override and internal work never claims SEO hours', () => {
    assert.equal(
        timerUi.stopReviewDefaults(attempt({ clientId: 'client-1', taskId: 'task-1', countsTowardBudget: false })).countsTowardBudget,
        false,
    );

    const internal = timerUi.stopReviewDefaults(attempt({ billable: false }));
    assert.equal(internal.countsTowardBudget, false);
    assert.equal(internal.billable, false);
    assert.equal(internal.canMarkTaskComplete, false);
});

test('review aggregates same-date segments into one total and reports each local date once', () => {
    const sameDay = timerUi.stopReviewSummary(attempt({
        segments: [
            segment('a', '2026-08-20T17:15:00.000Z', '2026-08-20T19:15:00.000Z'),
            segment('b', '2026-08-20T20:00:00.000Z', '2026-08-20T22:00:00.000Z'),
        ],
    }), 'America/Los_Angeles');

    assert.equal(sameDay.totalActiveSeconds, 14_400);
    assert.deepEqual(sameDay.dates, [{ localDate: '2026-08-20', activeSeconds: 14_400, segmentCount: 2 }]);
});

test('review splits midnight-crossing work into one row per local date', () => {
    const overnight = timerUi.stopReviewSummary(attempt({
        segments: [segment('a', '2026-08-21T06:30:00.000Z', '2026-08-21T07:30:00.000Z')],
    }), 'America/Los_Angeles');

    assert.equal(overnight.totalActiveSeconds, 3_600);
    assert.deepEqual(overnight.dates, [
        { localDate: '2026-08-20', activeSeconds: 1_800, segmentCount: 1 },
        { localDate: '2026-08-21', activeSeconds: 1_800, segmentCount: 1 },
    ]);
});

test('review keeps the pre-segment elapsed baseline on the attempt date', () => {
    const migrated = timerUi.stopReviewSummary(attempt({ date: '2026-08-19', elapsedSeconds: 600 }), 'UTC');

    assert.equal(migrated.totalActiveSeconds, 600);
    assert.deepEqual(migrated.dates, [{ localDate: '2026-08-19', activeSeconds: 600, segmentCount: 0 }]);
});

test('Basecamp sync eligibility explains why it is unavailable instead of hiding it', () => {
    assert.deepEqual(timerUi.basecampSyncEligibility(attempt({ clientId: 'client-1' }), true), { eligible: true });
    assert.equal(timerUi.basecampSyncEligibility(attempt({ clientId: 'client-1' }), false).eligible, false);
    assert.match(
        timerUi.basecampSyncEligibility(attempt({ clientId: 'client-1' }), false).reason ?? '',
        /not enabled for this client/i,
    );
    assert.match(
        timerUi.basecampSyncEligibility(attempt(), true).reason ?? '',
        /not linked to a client/i,
    );
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

test('sub-second segment drift never leaks into the reviewed duration', () => {
    const drifting = timerUi.stopReviewSummary(attempt({
        segments: [segment('a', '2026-08-20T17:00:00.250Z', '2026-08-20T17:30:00.750Z')],
    }), 'UTC');

    assert.equal(drifting.totalActiveSeconds, 1_801);
    assert.deepEqual(drifting.dates, [{ localDate: '2026-08-20', activeSeconds: 1_801, segmentCount: 1 }]);
});

test('a clean finalization reports saved so the sheet can close', () => {
    assert.deepEqual(
        timerUi.stopSubmitOutcome({ running: null, paused: [], finalizedTimeLogIds: ['day-1'], basecampStatus: 'synced' }),
        { status: 'saved' },
    );
    assert.deepEqual(
        timerUi.stopSubmitOutcome({ running: null, paused: [], finalizedTimeLogIds: ['day-1'], basecampStatus: 'not_requested' }),
        { status: 'saved' },
    );
});

test('a durable finalization with a failed side effect warns without claiming failure', () => {
    const completion = timerUi.stopSubmitOutcome({
        running: null, paused: [], finalizedTimeLogIds: ['day-1'],
        completionWarning: 'Time was saved, but task completion could not be fully recorded.',
    });
    assert.equal(completion.status, 'warned');
    assert.match(completion.message ?? '', /task completion/i);

    const basecamp = timerUi.stopSubmitOutcome({
        running: null, paused: [], finalizedTimeLogIds: ['day-1'], basecampStatus: 'failed',
    });
    assert.equal(basecamp.status, 'warned');
    assert.match(basecamp.message ?? '', /Basecamp/i);
});

test('a rejected finalization reports failure so the attempt stays retryable', () => {
    const failure = timerUi.stopSubmitFailure(new Error('Timer state conflict'));
    assert.equal(failure.status, 'failed');
    assert.match(failure.message ?? '', /Timer state conflict/);
    assert.match(timerUi.stopSubmitFailure('boom').message ?? '', /not be saved/i);
});

test('only finalization refreshes client activity and task state', () => {
    assert.deepEqual(timerUi.timerRefreshEvents('pause'), ['planner:data-changed', 'timer:data-changed']);
    assert.deepEqual(timerUi.timerRefreshEvents('start'), ['planner:data-changed', 'timer:data-changed']);
    assert.deepEqual(timerUi.timerRefreshEvents('finalize'), [
        'planner:data-changed',
        'timer:data-changed',
        'task:data-changed',
        'client-activity:data-changed',
    ]);
    assert.deepEqual(timerUi.timerRefreshEvents('retry_basecamp'), [
        'planner:data-changed',
        'timer:data-changed',
        'task:data-changed',
        'client-activity:data-changed',
    ]);
});

test('displayed attempt duration is always whole seconds', () => {
    // Segment timestamps carry milliseconds, so the raw difference is a float.
    // Any consumer that formats it (the tab title, the floating timer) would
    // otherwise render "02:23.944999999999993".
    const drifting = attempt({
        segments: [segment('a', '2026-08-20T17:00:00.250Z', '2026-08-20T17:02:23.195Z')],
    });

    const seconds = timerUi.totalAttemptActiveSeconds(drifting, new Date('2026-08-20T17:02:23.195Z'));
    assert.equal(Number.isInteger(seconds), true, `expected whole seconds, got ${seconds}`);
    assert.equal(seconds, 143);
});

test('a running attempt duration is whole seconds at any observation instant', () => {
    const running = attempt({ segments: [segment('open', '2026-08-20T17:00:00.123Z')] });
    const seconds = timerUi.totalAttemptActiveSeconds(running, new Date('2026-08-20T17:00:07.891Z'));

    assert.equal(Number.isInteger(seconds), true, `expected whole seconds, got ${seconds}`);
    assert.equal(seconds, 8);
});
