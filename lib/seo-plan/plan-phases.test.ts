import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIATIVE_PHASES } from '../campaign-workspace/initiatives.ts';
import { MARKETING_PLAN_STEPS } from '../marketing-plan-template.ts';
import { newClientPlanItems } from '../client-setup.ts';
import type { StageListTask } from './stage-list.ts';
import {
    PHASE_STAGE_COPY,
    groupTasksByPhase,
    isPlanPhase,
    phasePlanSteps,
    planBoardFromSteps,
    stagesForNewPlan,
} from './plan-phases.ts';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title' | 'stage'>): StageListTask {
    return {
        status: 'todo',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

test('a new plan has Foundation, Growth, and Scale and no tasks', () => {
    const created = stagesForNewPlan();
    assert.equal(created.board, 'phases');
    assert.deepEqual(created.tasks, []);
    assert.deepEqual(created.stages.map(stage => stage.id), [...INITIATIVE_PHASES]);
    assert.deepEqual(created.stages.map(stage => stage.title), ['Foundation', 'Growth', 'Scale']);
    assert.equal(created.stages[0]?.description, 'Fixing the basics so Google can find and trust the site.');
    assert.match(created.stages[1]?.description ?? '', /pages people are searching for/);
    assert.match(created.stages[2]?.description ?? '', /more of the right people/);
    assert.equal(created.stages.some(stage => /Phase \d|SEO|GBP/.test(`${stage.title} ${stage.description}`)), false);
    assert.equal(newClientPlanItems().length, 0);
});

test('setup marks the checklist steps as a phase board and leaves older steps on the month board', () => {
    const steps = phasePlanSteps();
    assert.deepEqual(steps.map(step => step.key), MARKETING_PLAN_STEPS.map(step => step.key));
    assert.equal(steps.every(step => step.workBoard === 'phases'), true);
    assert.equal(planBoardFromSteps(steps), 'phases');
    assert.equal(planBoardFromSteps(MARKETING_PLAN_STEPS), 'months');
    assert.equal(planBoardFromSteps(null), 'months');
    assert.equal(planBoardFromSteps([]), 'months');
    assert.equal(isPlanPhase('foundation'), true);
    assert.equal(isPlanPhase('month_1'), false);
    assert.equal(isPlanPhase('Phase 1 · Foundation'), false);
});

test('phase stages stay empty until a task is added, and a month stage is not rewritten', () => {
    const empty = groupTasksByPhase([], '', '2026-10-19');
    assert.deepEqual(empty.map(section => section.id), ['foundation', 'growth', 'scale']);
    assert.deepEqual(empty.map(section => section.groups.length), [0, 0, 0]);
    assert.equal(empty[0]?.description, PHASE_STAGE_COPY.foundation.description);

    const legacy = task({ id: 'month', title: 'Month one crawl', stage: 'month_1', position: 1 });
    const placed = groupTasksByPhase([
        task({ id: 'fix', title: 'Fix the sitemap', stage: 'foundation', position: 2 }),
        task({ id: 'page', title: 'Write the service page', stage: 'growth', position: 1 }),
        task({ id: 'more', title: 'Add another city page', stage: 'scale', position: 1 }),
        legacy,
    ], '', '2026-10-19');
    assert.deepEqual(placed.find(section => section.id === 'foundation')?.groups.map(group => group.task.id), ['month', 'fix']);
    assert.deepEqual(placed.find(section => section.id === 'growth')?.groups.map(group => group.task.id), ['page']);
    assert.deepEqual(placed.find(section => section.id === 'scale')?.groups.map(group => group.task.id), ['more']);
    assert.equal(placed.flatMap(section => section.groups).find(group => group.task.id === 'month')?.task.stage, 'month_1');
});
