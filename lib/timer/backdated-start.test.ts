import test from 'node:test';
import assert from 'node:assert/strict';
import {
    backdatedStartFromTime,
    startTimerMutation,
} from './backdated-start.ts';

test('backdatedStartFromTime converts a same-day time into a running elapsed timer', () => {
    const now = new Date(2026, 8, 2, 23, 30, 0, 0);
    const result = backdatedStartFromTime('23:00', now);

    assert.deepEqual(result, {
        startedAt: new Date(2026, 8, 2, 23, 0, 0, 0).toISOString(),
        elapsedMinutes: 30,
    });
});

test('backdatedStartFromTime rejects malformed, current, and future times', () => {
    const now = new Date(2026, 8, 2, 23, 30, 0, 0);

    assert.deepEqual(backdatedStartFromTime('not-a-time', now), {
        error: 'Choose a valid start time.',
    });
    assert.deepEqual(backdatedStartFromTime('23:30', now), {
        error: 'Choose a time earlier than now.',
    });
    assert.deepEqual(backdatedStartFromTime('23:45', now), {
        error: 'Choose a time earlier than now.',
    });
    assert.deepEqual(backdatedStartFromTime('23:30', new Date(2026, 8, 2, 23, 30, 45)), {
        error: 'Choose a time earlier than now.',
    });
});

test('startTimerMutation includes the selected backdated instant only when provided', () => {
    const startedAt = '2026-09-03T06:00:00.000Z';

    assert.deepEqual(startTimerMutation('task-1'), {
        action: 'start',
        taskId: 'task-1',
    });
    assert.deepEqual(startTimerMutation('task-1', startedAt, 'America/Los_Angeles'), {
        action: 'start',
        taskId: 'task-1',
        now: startedAt,
        timeZone: 'America/Los_Angeles',
    });
});
