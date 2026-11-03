import assert from 'node:assert/strict';
import test from 'node:test';

import type { Task } from '../types.ts';
import { taskWithBasecampLink } from './basecamp-send-state.ts';

function task(patch: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        organizationId: 'org-1',
        clientId: 'client-1',
        title: 'Write the Ecoworkz brief',
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
        ...patch,
    };
}

test('a reload that learned the saved to-do id replaces the drawer task that had none', () => {
    const open = task();
    const reloaded = task({
        basecampTodoId: '77',
        basecampProjectId: '202',
        lastSyncedAt: '2026-11-03T01:00:00.000Z',
        subtasks: [{ id: 'child-1', title: 'Outline', completed: false }],
        subtasksState: 'ready',
    });

    const next = taskWithBasecampLink(open, {
        basecampTodoId: reloaded.basecampTodoId,
        basecampProjectId: reloaded.basecampProjectId,
        lastSyncedAt: reloaded.lastSyncedAt,
        subtasks: reloaded.subtasks,
        subtasksState: reloaded.subtasksState,
    });

    assert.equal(next.basecampTodoId, '77');
    assert.equal(next.basecampProjectId, '202');
    assert.equal(next.lastSyncedAt, '2026-11-03T01:00:00.000Z');
    assert.equal(next.subtasks.length, 1);
    assert.equal(next.title, 'Write the Ecoworkz brief');
});

test('a reload that drops the to-do id keeps the id the send response already applied', () => {
    const linked = task({ basecampTodoId: '77', basecampProjectId: '202' });
    const next = taskWithBasecampLink(linked, {
        basecampTodoId: undefined,
        basecampProjectId: undefined,
        subtasks: [],
        subtasksState: 'ready',
    });
    assert.equal(next.basecampTodoId, '77');
    assert.equal(next.basecampProjectId, '202');
});
