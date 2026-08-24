import test from 'node:test';
import assert from 'node:assert/strict';
import {
    completeTaskWithReconciliation,
    completionReconciliation,
    formatCompletionDuration,
} from './task-completion.ts';

test('an untracked scheduled task recommends logging its scheduled duration', () => {
    assert.deepEqual(completionReconciliation({
        scheduledMinutes: 165,
        trackedHours: 0,
        hasOpenAttempt: false,
    }), {
        scheduledMinutes: 165,
        trackedMinutes: 0,
        varianceMinutes: -165,
        recommendedAdditionalMinutes: 165,
        mode: 'log_scheduled',
    });
});

test('existing tracked time is authoritative and is never recommended twice', () => {
    assert.deepEqual(completionReconciliation({
        scheduledMinutes: 165,
        trackedHours: 1.5,
        hasOpenAttempt: false,
    }), {
        scheduledMinutes: 165,
        trackedMinutes: 90,
        varianceMinutes: -75,
        recommendedAdditionalMinutes: 0,
        mode: 'tracked',
    });
});

test('an open timer routes completion through stop review', () => {
    assert.equal(completionReconciliation({
        scheduledMinutes: 165,
        trackedHours: 0,
        hasOpenAttempt: true,
    }).mode, 'stop_timer');
});

test('an unscheduled task without time stays a completion-only action', () => {
    assert.equal(completionReconciliation({
        trackedHours: 0,
        hasOpenAttempt: false,
    }).mode, 'complete_only');
});

test('completion duration uses compact human-readable copy', () => {
    assert.equal(formatCompletionDuration(0), '0m');
    assert.equal(formatCompletionDuration(45), '45m');
    assert.equal(formatCompletionDuration(165), '2h 45m');
});

test('time must be saved before the task is marked done', async () => {
    const calls: string[] = [];
    const result = await completeTaskWithReconciliation({
        taskId: 'task-1',
        additionalMinutes: 165,
        operationId: 'operation-1',
    }, {
        logTime: async input => {
            calls.push(`log:${input.additionalMinutes}:${input.operationId}`);
            return { success: true, timeLogId: 'log-1' };
        },
        markDone: async taskId => {
            calls.push(`done:${taskId}`);
            return { success: true, task: { id: taskId } };
        },
    });

    assert.deepEqual(calls, ['log:165:operation-1', 'done:task-1']);
    assert.deepEqual(result, {
        success: true,
        timeLogId: 'log-1',
        task: { id: 'task-1' },
    });
});

test('a failed time save leaves the task open', async () => {
    let markedDone = false;
    const result = await completeTaskWithReconciliation({
        taskId: 'task-1',
        additionalMinutes: 165,
        operationId: 'operation-1',
    }, {
        logTime: async () => ({ success: false, error: 'Time could not be saved' }),
        markDone: async () => {
            markedDone = true;
            return { success: true, task: { id: 'task-1' } };
        },
    });

    assert.equal(markedDone, false);
    assert.deepEqual(result, { success: false, error: 'Time could not be saved' });
});
