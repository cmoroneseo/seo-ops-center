import assert from 'node:assert/strict';
import test from 'node:test';

import { matchBotTask, type BotTaskRef } from './task-lookup.ts';

const tasks: BotTaskRef[] = [
    { id: 'parent-a', title: 'August blogs', parentTaskId: null },
    { id: 'parent-b', title: 'August blogs', parentTaskId: null },
    { id: 'parent-c', title: 'Citations', parentTaskId: null },
    { id: 'brief-a', title: 'Brief', parentTaskId: 'parent-a' },
    { id: 'draft-a', title: 'Draft', parentTaskId: 'parent-a' },
    { id: 'brief-a2', title: 'Brief', parentTaskId: 'parent-a' },
    { id: 'brief-c', title: 'Brief', parentTaskId: 'parent-c' },
];

test('taskTitle matches a top-level task and skips a subtask with the same title', () => {
    assert.deepEqual(matchBotTask(tasks, { taskTitle: 'Citations' }), { ok: true, taskId: 'parent-c' });
    assert.deepEqual(matchBotTask(tasks, { taskTitle: 'Brief' }), {
        ok: false,
        status: 404,
        code: 'task_not_found',
        error: 'Task not found.',
        reason: 'missing',
    });
});

test('parentTitle or parentTaskId plus taskTitle matches one subtask', () => {
    assert.deepEqual(matchBotTask(tasks, { taskTitle: 'Draft', parentTitle: 'August blogs' }), {
        ok: false,
        status: 409,
        code: 'ambiguous_task',
        error: 'More than one parent task has that exact title. Send parentTaskId.',
        reason: 'ambiguous',
    });
    assert.deepEqual(matchBotTask(tasks, { taskTitle: 'Brief', parentTaskId: 'parent-c' }), {
        ok: true,
        taskId: 'brief-c',
    });
    assert.deepEqual(matchBotTask(tasks, {
        taskTitle: 'Draft',
        parentTaskId: 'parent-a',
        parentTitle: 'August blogs',
    }), { ok: true, taskId: 'draft-a' });
});

test('a missing parent, a disagreeing parent, and two subtasks are 4xx', () => {
    assert.equal(matchBotTask(tasks, { taskTitle: 'Brief', parentTaskId: 'missing' }).ok, false);
    assert.equal(matchBotTask(tasks, { taskTitle: 'Brief', parentTitle: 'Nope' }).ok, false);
    const disagree = matchBotTask(tasks, {
        taskTitle: 'Brief',
        parentTaskId: 'parent-c',
        parentTitle: 'August blogs',
    });
    assert.equal(disagree.ok, false);
    if (!disagree.ok) {
        assert.equal(disagree.status, 409);
        assert.match(disagree.error, /parentTaskId and parentTitle/);
    }
    const both = matchBotTask(tasks, { taskTitle: 'Brief', parentTaskId: 'parent-a' });
    assert.equal(both.ok, false);
    if (!both.ok) {
        assert.equal(both.status, 409);
        assert.match(both.error, /subtask/);
    }
});
