import test from 'node:test';
import assert from 'node:assert/strict';

import type { Task } from '../types.ts';
import { mergeSavedTask } from './merge-saved-task.ts';

function task(patch: Partial<Task> = {}): Task {
    return {
        id: 'setup',
        organizationId: 'org',
        title: 'SEO Setup',
        description: 'Old notes',
        clientName: 'Sandbox Client A',
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [
            { id: 'keywords', title: 'Keywords', completed: true },
            { id: 'sitemap', title: 'Sitemap', completed: false },
        ],
        subtasksState: 'ready',
        dueDate: '2026-10-20',
        ...patch,
    };
}

test('a saved row refreshes the card and keeps the live subtask count', () => {
    const saved = task({
        title: 'SEO Setup revised',
        description: 'New notes',
        status: 'in_progress',
        dueDate: '2026-10-21',
        subtasks: [],
        subtasksState: undefined,
        clientName: undefined,
    });
    const next = mergeSavedTask(task(), saved);
    assert.equal(next.title, 'SEO Setup revised');
    assert.equal(next.description, 'New notes');
    assert.equal(next.status, 'in_progress');
    assert.equal(next.dueDate, '2026-10-21');
    assert.equal(next.clientName, 'Sandbox Client A');
    assert.equal(next.subtasksState, 'ready');
    assert.deepEqual(next.subtasks.map(item => item.id), ['keywords', 'sitemap']);
});

test('an explicit empty description clears the preview, and a ready empty subtask list clears the count', () => {
    const cleared = mergeSavedTask(task(), task({ description: '', subtasks: [], subtasksState: 'ready' }));
    assert.equal(cleared.description, '');
    assert.deepEqual(cleared.subtasks, []);
    assert.equal(cleared.subtasksState, 'ready');
});
