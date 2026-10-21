import assert from 'node:assert/strict';
import test from 'node:test';

import { groupTasksByPlanMonth } from './plan-sections.ts';
import { checklistTasksForPlan, onboardingSectionItems, onboardingSectionProgress, withChecklistTasks } from './plan-work.ts';
import type { StageListTask } from './stage-list.ts';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

test('onboarding progress counts the same tasks the plan header counts', () => {
    const tasks = [
        task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', status: 'done', position: 1 }),
        task({ id: 'ga', title: 'Connect GA4', stage: 'onboarding', parentTaskId: 'setup', status: 'done', position: 1 }),
        task({ id: 'ahrefs', title: 'Add project', stage: 'onboarding', parentTaskId: 'setup', status: 'done', position: 2 }),
        task({ id: 'rank', title: 'Rank tracking', stage: 'onboarding', parentTaskId: 'setup', status: 'done', position: 3 }),
        task({ id: 'cookies', title: 'Empire Cookies', stage: 'onboarding', parentTaskId: 'setup', status: 'done', position: 4 }),
        task({ id: 'roadmap', title: 'Create the roadmap', stage: 'onboarding', status: 'in_progress', position: 2 }),
    ];
    assert.deepEqual(onboardingSectionProgress(tasks), { done: 5, total: 6 });
    assert.equal(onboardingSectionItems(tasks).length, 6);
    assert.equal(onboardingSectionItems(tasks).filter(item => item.done).length, 5);
});

test('a dated checklist row with no task is in the same month as the overview Now lane', () => {
    const tasks = [
        task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', status: 'done' }),
    ];
    const items = [
        { id: 'cal', title: 'Build the editorial calendar', status: 'todo', dueDate: '2026-10-29' },
        { id: 'linked', title: 'SEO Setup', status: 'done', dueDate: '2026-10-20', taskId: 'setup' },
        { id: 'library', title: 'Inventory existing content', status: 'todo' },
        { id: 'skip', title: 'Ignored row', status: 'ignored', dueDate: '2026-10-02' },
    ];
    const shown = withChecklistTasks(tasks, items);
    assert.equal(checklistTasksForPlan(items, tasks).length, 1);
    const month = groupTasksByPlanMonth(shown, { month: '2026-10', today: '2026-10-21' })
        .find(section => section.id === 'this_month');
    assert.equal(month?.groups.some(group => group.task.title === 'Build the editorial calendar'), true);
    assert.equal(month?.groups.some(group => group.task.title === 'Inventory existing content'), false);
    assert.equal(onboardingSectionProgress(shown).total, 1);
});
