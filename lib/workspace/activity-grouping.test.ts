import test from 'node:test';
import assert from 'node:assert/strict';
import {
    groupClientActivity,
    type ActivityCorrelationInput,
} from './activity-grouping.ts';

interface Source {
    id: string;
    label: string;
}

function timeItem(overrides: {
    id?: string;
    operationId?: string;
    hours: number;
    occurredAt?: string;
    taskId?: string;
}): ActivityCorrelationInput<Source> {
    const id = overrides.id ?? 'time-1';
    return {
        item: { id, label: 'time' },
        kind: 'time_log',
        id,
        occurredAt: overrides.occurredAt ?? '2026-08-20T22:00:00.000Z',
        operationId: overrides.operationId,
        taskId: overrides.taskId ?? 'task-1',
        clientId: 'client-1',
        actorId: 'user-1',
        hours: overrides.hours,
    };
}

function taskEvent(overrides: {
    id?: string;
    operationId?: string;
    eventType: string;
    occurredAt?: string;
    taskId?: string;
    actorId?: string;
}): ActivityCorrelationInput<Source> {
    const id = overrides.id ?? 'event-1';
    return {
        item: { id, label: 'event' },
        kind: overrides.eventType === 'task.completed' ? 'task_completed' : 'other',
        id,
        occurredAt: overrides.occurredAt ?? '2026-08-20T22:00:01.000Z',
        operationId: overrides.operationId,
        taskId: overrides.taskId ?? 'task-1',
        clientId: 'client-1',
        actorId: overrides.actorId ?? 'user-1',
    };
}

test('same-operation completion and time render as one item', () => {
    const grouped = groupClientActivity([
        timeItem({ operationId: 'op-1', hours: 4 }),
        taskEvent({ operationId: 'op-1', eventType: 'task.completed' }),
    ]);

    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].kind, 'time_and_completion');
    assert.equal(grouped[0].hours, 4);
    assert.deepEqual(grouped[0].sourceIds, ['time-1', 'event-1']);
});

test('later completion remains separate and hours are not duplicated', () => {
    const grouped = groupClientActivity([
        timeItem({ operationId: 'op-1', hours: 4 }),
        taskEvent({ operationId: 'op-2', eventType: 'task.completed' }),
    ]);

    assert.equal(grouped.length, 2);
    assert.equal(grouped.filter(i => i.hours === 4).length, 1);
});

test('a missing operation ID never correlates by timestamp, task, or actor alone', () => {
    const grouped = groupClientActivity([
        timeItem({ hours: 4 }),
        taskEvent({ eventType: 'task.completed' }),
    ]);

    assert.equal(grouped.length, 2);
});

test('correlation requires matching task and actor as well as the operation ID', () => {
    const otherTask = groupClientActivity([
        timeItem({ operationId: 'op-1', hours: 4 }),
        taskEvent({ operationId: 'op-1', eventType: 'task.completed', taskId: 'task-2' }),
    ]);
    const otherActor = groupClientActivity([
        timeItem({ operationId: 'op-1', hours: 4 }),
        taskEvent({ operationId: 'op-1', eventType: 'task.completed', actorId: 'user-2' }),
    ]);

    assert.equal(otherTask.length, 2);
    assert.equal(otherActor.length, 2);
});

test('cross-midnight work groups completion once and keeps every daily total exactly once', () => {
    const grouped = groupClientActivity([
        timeItem({ id: 'time-day-1', operationId: 'op-1', hours: 2, occurredAt: '2026-08-20T20:00:00.000Z' }),
        timeItem({ id: 'time-day-2', operationId: 'op-1', hours: 3, occurredAt: '2026-08-21T20:00:00.000Z' }),
        taskEvent({ operationId: 'op-1', eventType: 'task.completed', occurredAt: '2026-08-21T20:00:01.000Z' }),
    ]);

    assert.equal(grouped.length, 2);
    assert.deepEqual(grouped.map(item => item.kind), ['time_and_completion', 'time']);
    assert.equal(grouped.reduce((sum, item) => sum + (item.hours ?? 0), 0), 5);
    assert.deepEqual(grouped[0].sourceIds, ['time-day-2', 'event-1']);
});

test('grouped items sort by their latest underlying occurrence', () => {
    const grouped = groupClientActivity([
        taskEvent({ id: 'event-old', operationId: 'op-old', eventType: 'task.status_changed', occurredAt: '2026-08-19T10:00:00.000Z' }),
        timeItem({ operationId: 'op-1', hours: 4, occurredAt: '2026-08-20T22:00:00.000Z' }),
        taskEvent({ operationId: 'op-1', eventType: 'task.completed', occurredAt: '2026-08-20T23:00:00.000Z' }),
    ]);

    assert.deepEqual(grouped.map(item => item.occurredAt), [
        '2026-08-20T23:00:00.000Z',
        '2026-08-19T10:00:00.000Z',
    ]);
});

test('Basecamp status stays metadata on the grouped time item, never a third feed item', () => {
    const grouped = groupClientActivity([
        { ...timeItem({ operationId: 'op-1', hours: 4 }), basecampStatus: 'synced' },
        taskEvent({ operationId: 'op-1', eventType: 'task.completed' }),
    ]);

    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].basecampStatus, 'synced');
});

test('an operation that never completed a task leaves its time row untouched', () => {
    const grouped = groupClientActivity([
        timeItem({ operationId: 'op-1', hours: 4 }),
        taskEvent({ operationId: 'op-1', eventType: 'task.status_changed' }),
    ]);

    assert.equal(grouped.length, 2);
    assert.deepEqual(grouped.map(item => item.kind).sort(), ['other', 'time']);
});
