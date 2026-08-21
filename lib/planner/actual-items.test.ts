import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TimeLogSegment, TimerAttempt } from '../types.ts';
import {
    actualAttemptToItems,
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
