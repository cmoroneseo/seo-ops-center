import assert from 'node:assert/strict';
import test from 'node:test';

import { checklistTasksForPlan, withChecklistTasks } from './plan-work.ts';
import type { StageListTask } from './stage-list.ts';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',

        position: 1,
        parentTaskId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

test('a dated checklist row without a task still appears on the work plan', () => {
    const tasks = [
        task({ id: 'setup', title: 'SEO Setup', status: 'done' }),
    ];
    const items = [
        { id: 'cal', title: 'Build the editorial calendar', status: 'todo', dueDate: '2026-10-29' },
        { id: 'linked', title: 'SEO Setup', status: 'done', dueDate: '2026-10-20', taskId: 'setup' },
        { id: 'library', title: 'Inventory existing content', status: 'todo' },
        { id: 'skip', title: 'Ignored row', status: 'ignored', dueDate: '2026-10-02' },
    ];
    const shown = withChecklistTasks(tasks, items);
    assert.deepEqual(shown.map(task => task.id), ['setup', 'checklist:cal']);
    assert.equal(shown[1].dueDate, '2026-10-29');
    assert.equal(checklistTasksForPlan(items, tasks).length, 1);
});
