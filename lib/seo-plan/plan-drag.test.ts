import assert from 'node:assert/strict';
import test from 'node:test';

import { dueDateForSectionDrop, effectOfPlanDrop } from './plan-drag.ts';
import { groupTasksByPlanMonth } from './plan-sections.ts';
import { applyStageReorder } from './stage-reorder.ts';
import type { StageListTask } from './stage-list.ts';

const MONTH = '2026-10';
const TODAY = '2026-10-19';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

function apply(tasks: StageListTask[], effect: NonNullable<ReturnType<typeof effectOfPlanDrop>>): StageListTask[] {
    const plan = applyStageReorder(tasks, effect.move);
    if (!plan.ok) throw new Error(plan.error);
    return plan.tasks.map(item => (
        effect.dueDate !== undefined && item.id === effect.move.taskId
            ? { ...item, dueDate: effect.dueDate }
            : item
    ));
}

function sectionIds(tasks: StageListTask[], section: 'onboarding' | 'this_month' | 'backlog') {
    return groupTasksByPlanMonth(tasks, { month: MONTH, today: TODAY })
        .find(item => item.id === section)
        ?.groups.map(group => group.task.id) ?? [];
}

const kitchen = task({ id: 'kitchen', title: 'Kitchen page', position: 1, dueDate: '2026-10-17' });
const gbp = task({ id: 'gbp', title: 'GBP optimization', position: 2, dueDate: '2026-10-22' });
const someday = task({ id: 'someday', title: 'Someday task', position: 3 });
const kickoff = task({ id: 'kickoff', title: 'Kickoff call', stage: 'onboarding', position: 1, dueDate: '2026-10-14' });
const pillar = task({ id: 'citations', title: 'Citations cleanup', stage: 'onboarding', position: 2 });
const houzz = task({ id: 'houzz', title: 'Houzz profile', stage: 'onboarding', parentTaskId: 'citations', position: 1, dueDate: '2026-10-23' });
const yelp = task({ id: 'yelp', title: 'Fix Yelp', stage: 'onboarding', parentTaskId: 'citations', position: 2 });

test('reordering inside This month keeps the due date and the manual order', () => {
    const tasks = [kitchen, gbp, someday];
    const effect = effectOfPlanDrop({
        tasks,
        dragId: 'gbp',
        section: 'this_month',
        beforeTaskId: 'kitchen',
        parentTaskId: null,
        month: MONTH,
        today: TODAY,
    });
    assert.ok(effect);
    assert.equal(effect.dueDate, undefined);
    assert.equal(effect.move.stage, 'backlog');
    const next = apply(tasks, effect);
    assert.deepEqual(sectionIds(next, 'this_month'), ['gbp', 'kitchen']);
    assert.equal(next.find(item => item.id === 'gbp')?.dueDate, '2026-10-22');
});

test('a backlog row dropped on This month is due at the end of the selected month', () => {
    const tasks = [kitchen, someday];
    const effect = effectOfPlanDrop({
        tasks,
        dragId: 'someday',
        section: 'this_month',
        beforeTaskId: null,
        parentTaskId: null,
        month: MONTH,
        today: TODAY,
    });
    assert.equal(effect?.dueDate, '2026-10-31');
    assert.equal(effect?.move.stage, 'backlog');
    const next = apply(tasks, effect!);
    assert.deepEqual(sectionIds(next, 'this_month'), ['kitchen', 'someday']);
    assert.equal(sectionIds(next, 'backlog').includes('someday'), false);
    assert.equal(dueDateForSectionDrop(gbp, 'this_month', MONTH), undefined);
});

test('dropping a dated row on Backlog clears the due date', () => {
    const effect = effectOfPlanDrop({
        tasks: [kitchen, gbp, someday],
        dragId: 'kitchen',
        section: 'backlog',
        beforeTaskId: 'someday',
        parentTaskId: null,
        month: MONTH,
        today: TODAY,
    });
    assert.equal(effect?.dueDate, null);
    assert.equal(effect?.move.stage, 'backlog');
    const next = apply([kitchen, gbp, someday], effect!);
    assert.equal(next.find(item => item.id === 'kitchen')?.dueDate, null);
    assert.deepEqual(sectionIds(next, 'backlog'), ['kitchen', 'someday']);
    assert.equal(sectionIds(next, 'this_month').includes('kitchen'), false);
});

test('Onboarding and Backlog exchange the stage, and This month dates an onboarding row', () => {
    const intoMonth = effectOfPlanDrop({
        tasks: [kickoff, kitchen],
        dragId: 'kickoff',
        section: 'this_month',
        beforeTaskId: null,
        parentTaskId: null,
        month: MONTH,
        today: TODAY,
    });
    assert.equal(intoMonth?.move.stage, 'backlog');
    assert.equal(intoMonth?.dueDate, undefined);
    const dated = apply([kickoff, kitchen], intoMonth!);
    assert.equal(dated.find(item => item.id === 'kickoff')?.stage, 'backlog');
    assert.equal(dated.find(item => item.id === 'kickoff')?.dueDate, '2026-10-14');
    assert.equal(sectionIds(dated, 'onboarding').includes('kickoff'), false);
    assert.equal(sectionIds(dated, 'this_month').includes('kickoff'), true);

    const undated = task({ id: 'checklist', title: 'Checklist', stage: 'onboarding', position: 2 });
    const needsDate = effectOfPlanDrop({
        tasks: [undated, kitchen],
        dragId: 'checklist',
        section: 'this_month',
        beforeTaskId: null,
        parentTaskId: null,
        month: MONTH,
        today: TODAY,
    });
    assert.equal(needsDate?.dueDate, '2026-10-31');
    assert.equal(needsDate?.move.stage, 'backlog');

    const intoBacklog = effectOfPlanDrop({
        tasks: [kickoff, someday],
        dragId: 'kickoff',
        section: 'backlog',
        beforeTaskId: null,
        parentTaskId: null,
        month: MONTH,
        today: TODAY,
    });
    assert.equal(intoBacklog?.move.stage, 'backlog');
    assert.equal(intoBacklog?.dueDate, null);

    const intoOnboarding = effectOfPlanDrop({
        tasks: [someday, kickoff],
        dragId: 'someday',
        section: 'onboarding',
        beforeTaskId: null,
        parentTaskId: null,
        month: MONTH,
        today: TODAY,
    });
    assert.equal(intoOnboarding?.move.stage, 'onboarding');
    assert.equal(intoOnboarding?.dueDate, undefined);
    const onboarded = apply([someday, kickoff], intoOnboarding!);
    assert.equal(onboarded.find(item => item.id === 'someday')?.stage, 'onboarding');
    assert.equal(onboarded.find(item => item.id === 'someday')?.dueDate, undefined);
    assert.deepEqual(sectionIds(onboarded, 'onboarding'), ['kickoff', 'someday']);
});

test('subtasks reorder inside a pillar without a due-date change, and leaving the pillar follows the section', () => {
    const tasks = [pillar, houzz, yelp];
    const reorder = effectOfPlanDrop({
        tasks,
        dragId: 'yelp',
        section: 'onboarding',
        beforeTaskId: 'houzz',
        parentTaskId: 'citations',
        month: MONTH,
        today: TODAY,
    });
    assert.ok(reorder);
    assert.equal(reorder.dueDate, undefined);
    assert.equal(reorder.move.parentTaskId, 'citations');
    assert.equal(reorder.move.stage, 'onboarding');
    const next = apply(tasks, reorder);
    const children = groupTasksByPlanMonth(next, { month: MONTH, today: TODAY })
        .find(section => section.id === 'onboarding')
        ?.groups.find(group => group.task.id === 'citations')
        ?.children.map(child => child.id);
    assert.deepEqual(children, ['yelp', 'houzz']);
    assert.equal(next.find(item => item.id === 'yelp')?.dueDate, undefined);

    const leave = effectOfPlanDrop({
        tasks,
        dragId: 'yelp',
        section: 'backlog',
        beforeTaskId: null,
        parentTaskId: null,
        month: MONTH,
        today: TODAY,
    });
    assert.equal(leave?.move.parentTaskId, null);
    assert.equal(leave?.move.stage, 'backlog');
    assert.equal(leave?.dueDate, null);
    const parked = apply(tasks, leave!);
    assert.equal(parked.find(item => item.id === 'yelp')?.parentTaskId, null);
    assert.equal(parked.find(item => item.id === 'yelp')?.stage, 'backlog');
    assert.equal(sectionIds(parked, 'backlog').includes('yelp'), true);
});

test('a future selected month dates a dropped row on that month, not the current one', () => {
    const effect = effectOfPlanDrop({
        tasks: [someday],
        dragId: 'someday',
        section: 'this_month',
        beforeTaskId: null,
        parentTaskId: null,
        month: '2026-11',
        today: TODAY,
    });
    assert.equal(effect?.dueDate, '2026-11-30');
});
