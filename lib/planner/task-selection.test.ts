import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskForQuery } from './task-selection.ts';
import type { Task } from '../types';

function makeTask(id: string): Task {
    return {
        id,
        organizationId: 'org1',
        title: `Task ${id}`,
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
    };
}

test('taskForQuery selects the canonical task matching a deep-link id', () => {
    const wanted = makeTask('wanted');
    assert.equal(taskForQuery([makeTask('first'), wanted], 'wanted'), wanted);
});

test('taskForQuery ignores missing, blank, and unknown ids', () => {
    const tasks = [makeTask('first')];
    assert.equal(taskForQuery(tasks, null), null);
    assert.equal(taskForQuery(tasks, '  '), null);
    assert.equal(taskForQuery(tasks, 'missing'), null);
});
