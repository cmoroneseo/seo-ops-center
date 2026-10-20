import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TimeLogSegment, TimerAttempt } from '../types.ts';
import {
    actualAttemptToItems,
    actualAttemptsToItems,
    monthItemPresentation,
    resolvePlannerSelection,
    shouldRenderForecast,
    timerActionsForItem,
} from './actual-items.ts';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        organizationId: 'org-1',
        title: 'Write launch brief',
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
        startDate: '2026-08-20T17:00:00.000Z',
        scheduledMinutes: 90,
        ...overrides,
    } as Task;
}

function segment(id: string, startedAt: string, endedAt?: string): TimeLogSegment {
    return {
        id,
        timeLogId: 'attempt-1',
        organizationId: 'org-1',
        userId: 'user-1',
        startedAt,
        endedAt,
    };
}

function makeAttempt(overrides: Partial<TimerAttempt> = {}): TimerAttempt {
    return {
        id: 'attempt-1',
        organizationId: 'org-1',
        taskId: 'task-1',
        taskTitle: 'Write launch brief',
        userId: 'user-1',
        date: '2026-08-20',
        hours: 0,
        description: '',
        billable: true,
        countsTowardBudget: true,
        status: 'in_progress',
        elapsedSeconds: 0,
        sessionNotes: [],
        plannedStartsAt: '2026-08-20T17:00:00.000Z',
        plannedMinutes: 90,
        segments: [segment('segment-1', '2026-08-20T18:00:00.000Z')],
        ...overrides,
    };
}

test('a task forecast renders before its timer starts', () => {
    assert.equal(shouldRenderForecast(makeTask(), []), true);
});

test('an attempt snapshot hides only the forecast instance it consumed', () => {
    const attempt = makeAttempt();
    assert.equal(shouldRenderForecast(makeTask(), [attempt]), false);

    const newlyScheduled = makeTask({
        startDate: '2026-08-21T17:00:00.000Z',
        scheduledMinutes: 60,
    });
    assert.equal(shouldRenderForecast(newlyScheduled, [attempt]), true);
});

test('a logged attempt snapshot also hides the matching consumed forecast', () => {
    assert.equal(shouldRenderForecast(makeTask(), [makeAttempt({ status: 'logged' })]), false);
});

test('a 45-minute pause leaves two actual-work cards', () => {
    const items = actualAttemptToItems(makeAttempt({
        segments: [
            segment('segment-1', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
            segment('segment-2', '2026-08-20T18:45:00.000Z', '2026-08-20T19:45:00.000Z'),
        ],
    }), new Date('2026-08-20T20:00:00.000Z'));

    assert.deepEqual(items.map(item => [item.startsAt, item.endsAt, item.activeSeconds]), [
        ['2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z', 3_600],
        ['2026-08-20T18:45:00.000Z', '2026-08-20T19:45:00.000Z', 3_600],
    ]);
});

test('a four-minute pause merges into one card but excludes the pause from active time', () => {
    const items = actualAttemptToItems(makeAttempt({
        segments: [
            segment('segment-1', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
            segment('segment-2', '2026-08-20T18:04:00.000Z', '2026-08-20T19:00:00.000Z'),
        ],
    }), new Date('2026-08-20T20:00:00.000Z'));

    assert.equal(items.length, 1);
    assert.equal(items[0].startsAt, '2026-08-20T17:00:00.000Z');
    assert.equal(items[0].endsAt, '2026-08-20T19:00:00.000Z');
    assert.equal(items[0].activeSeconds, 6_960);
});

test('a running actual-work card ends at the injected current time', () => {
    const now = new Date('2026-08-20T18:37:12.000Z');
    const [item] = actualAttemptToItems(makeAttempt(), now);

    assert.equal(item.endsAt, now.toISOString());
    assert.equal(item.activeSeconds, 2_232);
    assert.equal(item.timerState, 'running');
});

test('actual-work cards are timeline evidence and never draggable', () => {
    const [item] = actualAttemptToItems(makeAttempt({
        status: 'in_progress',
        timerStartedAt: undefined,
        segments: [segment(
            'segment-1',
            '2026-08-20T17:00:00.000Z',
            '2026-08-20T18:00:00.000Z',
        )],
    }), new Date('2026-08-20T20:00:00.000Z'));

    assert.equal(item.source, 'actual_time');
    assert.equal(item.attemptId, 'attempt-1');
    assert.equal(item.timerState, 'paused');
    assert.equal(item.draggable, false);
});

test('timer actions follow forecast, running, paused, and logged states', () => {
    const forecast = {
        id: 'task:task-1',
        source: 'task',
        timerState: undefined,
    } as ReturnType<typeof actualAttemptToItems>[number];
    const actual = (state: 'running' | 'paused' | 'logged') => ({
        ...forecast,
        id: `actual:attempt-1:${state}`,
        source: 'actual_time',
        timerState: state,
    } as ReturnType<typeof actualAttemptToItems>[number]);

    assert.deepEqual(timerActionsForItem(forecast), ['start']);
    assert.deepEqual(timerActionsForItem(actual('running')), ['pause', 'stop']);
    assert.deepEqual(timerActionsForItem(actual('paused')), ['resume', 'stop']);
    assert.deepEqual(timerActionsForItem(actual('logged')), []);
});

test('selection preserves the exact later display group before attempt fallback', () => {
    const groups = actualAttemptToItems(makeAttempt({
        segments: [
            segment('segment-1', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
            segment('segment-2', '2026-08-20T18:45:00.000Z', '2026-08-20T19:45:00.000Z'),
        ],
    }), new Date('2026-08-20T20:00:00.000Z'));
    const refreshed = groups.map(item => ({ ...item }));

    assert.equal(resolvePlannerSelection(groups[1], refreshed).id, 'actual:attempt-1:1');
    assert.equal(
        resolvePlannerSelection({ ...groups[1], id: 'actual:attempt-1:missing' }, refreshed).id,
        'actual:attempt-1:0',
    );
});

test('reviewing attempts are textual Reviewing and expose only Stop/Review', () => {
    const [item] = actualAttemptToItems(makeAttempt({
        reviewingAt: '2026-08-20T18:00:00.000Z',
        segments: [segment(
            'segment-1',
            '2026-08-20T17:00:00.000Z',
            '2026-08-20T18:00:00.000Z',
        )],
    }), new Date('2026-08-20T20:00:00.000Z'));

    assert.equal(item.timerState, 'reviewing');
    assert.deepEqual(timerActionsForItem(item), ['stop']);
    assert.equal(monthItemPresentation(item, true).stateLabel, 'Reviewing');
});

test('month presentation gives actual work state, range, duration, and controls', () => {
    const [item] = actualAttemptToItems(makeAttempt({
        segments: [segment(
            'segment-1',
            '2026-08-20T17:00:00.000',
            '2026-08-20T18:00:00.000',
        )],
    }), new Date('2026-08-21T12:00:00.000Z'));
    const presentation = monthItemPresentation(item, true);

    assert.equal(presentation.stateLabel, 'Paused');
    assert.deepEqual(presentation.actions, ['resume', 'stop']);
    assert.match(presentation.accessibleName, /Write launch brief/);
    assert.match(presentation.accessibleName, /5:00 PM – 6:00 PM/);
    assert.match(presentation.accessibleName, /1 hr active/);
    assert.match(presentation.accessibleName, /Paused/);
});

test('a manual start and finish render as one timed block, and hours-only stays off the grid', () => {
    const placed = actualAttemptToItems(makeAttempt({
        status: 'logged',
        hours: 0.82,
        plannedStartsAt: undefined,
        plannedMinutes: undefined,
        segments: [segment('segment-1', '2026-07-15T19:42:00.000Z', '2026-07-15T20:31:00.000Z')],
    }), new Date('2026-07-16T00:00:00.000Z'));

    assert.equal(placed.length, 1);
    assert.equal(placed[0].allDay, false);
    assert.equal(placed[0].source, 'actual_time');
    assert.equal(placed[0].id, 'actual:attempt-1:0');
    assert.equal(placed[0].startsAt, '2026-07-15T19:42:00.000Z');
    assert.equal(placed[0].endsAt, '2026-07-15T20:31:00.000Z');

    const hoursOnly = actualAttemptToItems(makeAttempt({
        status: 'logged',
        hours: 0.82,
        plannedStartsAt: undefined,
        plannedMinutes: undefined,
        segments: [],
    }), new Date('2026-07-16T00:00:00.000Z'));
    assert.deepEqual(hoursOnly, []);
});

test('several manual logs on one task each keep their own slot', () => {
    const now = new Date('2026-07-18T00:00:00.000Z');
    const logs = [
        makeAttempt({
            id: 'mon',
            date: '2026-07-13',
            status: 'logged',
            hours: 1,
            plannedStartsAt: undefined,
            segments: [segment('mon-1', '2026-07-13T16:00:00.000Z', '2026-07-13T17:00:00.000Z')],
        }),
        makeAttempt({
            id: 'tue',
            date: '2026-07-14',
            status: 'logged',
            hours: 0.82,
            plannedStartsAt: undefined,
            segments: [segment('tue-1', '2026-07-14T19:42:00.000Z', '2026-07-14T20:31:00.000Z')],
        }),
        makeAttempt({
            id: 'wed',
            date: '2026-07-15',
            status: 'logged',
            hours: 0.75,
            plannedStartsAt: undefined,
            segments: [segment('wed-1', '2026-07-15T18:15:00.000Z', '2026-07-15T19:00:00.000Z')],
        }),
    ];

    const items = actualAttemptsToItems(logs, now);
    assert.deepEqual(items.map(item => [item.id, item.allDay, item.startsAt, item.endsAt]), [
        ['actual:mon:0', false, '2026-07-13T16:00:00.000Z', '2026-07-13T17:00:00.000Z'],
        ['actual:tue:0', false, '2026-07-14T19:42:00.000Z', '2026-07-14T20:31:00.000Z'],
        ['actual:wed:0', false, '2026-07-15T18:15:00.000Z', '2026-07-15T19:00:00.000Z'],
    ]);
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
});

test('a resumed timer and nearby manual logs all stay visible', () => {
    // Migration 112 resumes the same open attempt, so the pause is two segments
    // on one log. The five-minute rule still merges only inside that log.
    // A manual entry two minutes after a segment is a different log and must
    // not be folded into the timer card or dropped.
    const now = new Date('2026-08-20T20:00:00.000Z');
    const resumed = makeAttempt({
        id: 'timer',
        status: 'logged',
        hours: 2,
        segments: [
            segment('run-1', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
            segment('run-2', '2026-08-20T18:45:00.000Z', '2026-08-20T19:45:00.000Z'),
        ],
    });
    const justAfter = makeAttempt({
        id: 'manual-after',
        status: 'logged',
        hours: 0.5,
        plannedStartsAt: undefined,
        segments: [segment('manual-1', '2026-08-20T18:02:00.000Z', '2026-08-20T18:32:00.000Z')],
    });
    const otherDay = makeAttempt({
        id: 'manual-friday',
        date: '2026-08-21',
        status: 'logged',
        hours: 0.82,
        plannedStartsAt: undefined,
        segments: [segment('manual-2', '2026-08-21T19:42:00.000Z', '2026-08-21T20:31:00.000Z')],
    });

    const items = actualAttemptsToItems([resumed, justAfter, otherDay], now);
    assert.deepEqual(items.map(item => [item.id, item.startsAt, item.endsAt]), [
        ['actual:timer:0', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'],
        ['actual:timer:1', '2026-08-20T18:45:00.000Z', '2026-08-20T19:45:00.000Z'],
        ['actual:manual-after:0', '2026-08-20T18:02:00.000Z', '2026-08-20T18:32:00.000Z'],
        ['actual:manual-friday:0', '2026-08-21T19:42:00.000Z', '2026-08-21T20:31:00.000Z'],
    ]);
    assert.equal(items.every(item => item.allDay === false && item.source === 'actual_time'), true);
    assert.equal(shouldRenderForecast(makeTask(), [justAfter, otherDay]), true);
});
