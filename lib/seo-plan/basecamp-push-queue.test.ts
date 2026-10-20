import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlanBasecampPushQueue } from './basecamp-push-queue.ts';

test('edits inside two seconds collapse into one push', () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const pushed: string[] = [];
    const queue = createPlanBasecampPushQueue({
        delayMs: 2000,
        setTimer: (fn, ms) => {
            const handle = { fn, ms };
            timers.push(handle);
            return handle;
        },
        clearTimer: handle => {
            const timer = handle as { fn: () => void };
            const index = timers.findIndex(item => item === timer);
            if (index >= 0) timers.splice(index, 1);
        },
        push: taskId => { pushed.push(taskId); },
    });

    queue.queue('task-1');
    queue.queue('task-1');
    queue.queue('task-2');
    assert.equal(timers.length, 2);
    assert.equal(timers.every(timer => timer.ms === 2000), true);
    for (const timer of [...timers]) timer.fn();
    assert.deepEqual(pushed, ['task-1', 'task-2']);
});
