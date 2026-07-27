import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskStart, taskToItem, TASK_DEFAULT_MINUTES } from './items.ts';
import type { Task } from '../types';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 't1',
        organizationId: 'org1',
        title: 'Write blog post',
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
        ...overrides,
    } as Task;
}

// --- parseTaskStart ---------------------------------------------------------

test('parseTaskStart reads a bare date as LOCAL midnight, not UTC', () => {
    const d = parseTaskStart('2026-07-30');
    assert.ok(d);
    // The whole point: the calendar day must survive in a negative-offset zone.
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 6); // July
    assert.equal(d.getDate(), 30);
    assert.equal(d.getHours(), 0);
});

test('parseTaskStart keeps the time of day from a full timestamp', () => {
    const iso = new Date(2026, 6, 30, 9, 15).toISOString();
    const d = parseTaskStart(iso);
    assert.ok(d);
    assert.equal(d.getDate(), 30);
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 15);
});

test('parseTaskStart returns null for garbage', () => {
    assert.equal(parseTaskStart('not-a-date'), null);
});

// --- taskToItem -------------------------------------------------------------

test('taskToItem returns null for an unscheduled task (the backlog)', () => {
    assert.equal(taskToItem(makeTask()), null);
});

test('taskToItem sizes a block from estimatedHours', () => {
    const item = taskToItem(makeTask({
        startDate: new Date(2026, 6, 30, 9, 0).toISOString(),
        estimatedHours: 2,
    }));
    assert.ok(item);
    const mins = (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000;
    assert.equal(mins, 120);
});

test('taskToItem falls back to a one-hour block when estimatedHours is missing', () => {
    const item = taskToItem(makeTask({ startDate: new Date(2026, 6, 30, 9, 0).toISOString() }));
    assert.ok(item);
    const mins = (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000;
    assert.equal(mins, TASK_DEFAULT_MINUTES);
});

test('taskToItem keeps a bare-date task on its own calendar day', () => {
    const item = taskToItem(makeTask({ startDate: '2026-07-30' }));
    assert.ok(item);
    assert.equal(new Date(item.startsAt).getDate(), 30);
});
