import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatBlockDuration, parseDurationInput, hoursFromMinutes, taskBlockLogInput,
} from './task-block-log.ts';

test('a block reads the way a person would say it', () => {
    assert.equal(formatBlockDuration(165), '2h 45m');
    assert.equal(formatBlockDuration(180), '3h');
    assert.equal(formatBlockDuration(45), '45m');
});

test('durations are accepted in the shapes people type', () => {
    assert.equal(parseDurationInput('2h 45m'), 165);
    assert.equal(parseDurationInput('2:45'), 165);
    assert.equal(parseDurationInput('45m'), 45);
    assert.equal(parseDurationInput('3h'), 180);
});

test('a bare number means hours, as it does in the task modal', () => {
    // The same "2.75" must not mean 2.75 hours in one field and 2.75 minutes
    // in another.
    assert.equal(parseDurationInput('2.75'), 165);
    assert.equal(parseDurationInput('1'), 60);
});

test('text that is not a duration is refused rather than guessed at', () => {
    for (const input of ['', '   ', 'abc', '2h 75x', '-30']) {
        assert.equal(parseDurationInput(input), null, input);
    }
});

test('zero is not a duration', () => {
    assert.equal(parseDurationInput('0'), null);
    assert.equal(parseDurationInput('0m'), null);
});

const context = {
    organizationId: 'org-a',
    userId: 'user-1',
    taskId: 'task-1',
    clientId: 'client-a',
    taskTitle: 'August Content: 4 Blogs, 1 Category, 1 Refresh',
    date: '2026-08-26',
};

test('a worked block becomes hours on the block’s own date', () => {
    const input = taskBlockLogInput(context, {
        minutes: 165, note: 'Drafted two blogs', countsTowardBudget: true,
    });
    assert.equal(input.hours, 2.75);
    // Logged after the fact: the block's date, never today's.
    assert.equal(input.date, '2026-08-26');
    assert.equal(input.description, 'Drafted two blogs');
    assert.equal(input.taskId, 'task-1');
});

test('an empty note falls back to the task title', () => {
    const input = taskBlockLogInput(context, {
        minutes: 60, note: '   ', countsTowardBudget: true,
    });
    assert.equal(input.description, context.taskTitle);
});

test('the budget choice is carried, never recomputed', () => {
    const excluded = taskBlockLogInput(context, {
        minutes: 60, note: '', countsTowardBudget: false,
    });
    assert.equal(excluded.countsTowardBudget, false);
});

test('logging time says nothing about task status', () => {
    // The gap this closes: the only one-click path to logging a task's time
    // was marking it done. Nothing here may carry a status.
    const input = taskBlockLogInput(context, {
        minutes: 165, note: '', countsTowardBudget: true,
    }) as Record<string, unknown>;
    assert.equal('status' in input, false);
    assert.equal('completedAt' in input, false);
});

test('odd minute counts round to two decimal places', () => {
    assert.equal(hoursFromMinutes(50), 0.83);
    assert.equal(hoursFromMinutes(165), 2.75);
});
