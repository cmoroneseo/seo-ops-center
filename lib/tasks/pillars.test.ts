import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketingPlanItem } from '../types.ts';
import {
    defaultNestSelection,
    defaultPillarTitle,
    itemsEligibleForPillarNest,
    nestCandidateFromPlanItem,
    planNestUnderPillar,
    planPillarFromItems,
    rollupLoggedHours,
    suggestPillarGroup,
    timeTrackingTaskId,
    SEO_SETUP_PILLAR_TITLE,
} from './pillars.ts';

function item(over: Partial<MarketingPlanItem> & { estimatedHours?: number | null } = {}): MarketingPlanItem & { estimatedHours?: number | null } {
    return {
        id: 'i1', marketingPlanId: 'p1', organizationId: 'o1', clientId: 'c1',
        stepKey: 'setup', title: 'Connect analytics', status: 'todo', priority: 'medium',
        sortOrder: 0, comments: [], isCustom: false, roadmapIncluded: true, roadmapPhase: 'onboarding',
        createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
        ...over,
    };
}

test('time prefers the pillar and leaves recurring successors alone', () => {
    assert.equal(timeTrackingTaskId({ id: 'parent' }), 'parent');
    assert.equal(timeTrackingTaskId({ id: 'child', parentTaskId: 'parent', title: 'Connect analytics' }), 'parent');
    assert.equal(timeTrackingTaskId({
        id: 'next',
        parentTaskId: 'done',
        title: 'Monthly report',
        recurrence: { freq: 'monthly' },
    }), 'next');
    assert.equal(timeTrackingTaskId(
        { id: 'next', parentTaskId: 'done', title: 'Monthly report' },
        { title: 'Monthly report' },
    ), 'next');
});

test('logged hours roll up from the pillar and its subtasks once', () => {
    const total = rollupLoggedHours([
        { taskId: 'pillar', hours: 1 },
        { taskId: 'child', hours: 0.25 },
        { taskId: 'other', hours: 4 },
        { taskId: 'child', hours: Number.NaN },
    ], 'pillar', ['child']);
    assert.equal(total, 1.25);
});

test('same-owner short setup chores suggest one SEO Setup pillar', () => {
    const suggestion = suggestPillarGroup([
        item({ id: 'a', assigneeId: 'abel' }),
        item({ id: 'b', title: 'Add the project', assigneeId: 'abel', estimatedHours: 0.25 }),
    ]);
    assert.equal(suggestion?.title, SEO_SETUP_PILLAR_TITLE);
    assert.match(suggestion?.reason ?? '', /same owner/);

    assert.equal(suggestPillarGroup([
        item({ assigneeId: 'abel' }),
        item({ id: 'b', assigneeId: 'carlos' }),
    ]), null);
    assert.equal(suggestPillarGroup([
        item({ estimatedHours: 2 }),
        item({ id: 'b' }),
    ]), null);
    assert.equal(suggestPillarGroup([
        item({ stepKey: 'technical' }),
        item({ id: 'b', stepKey: 'technical' }),
    ]), null);
    assert.equal(defaultPillarTitle([item({ stepKey: 'technical' })], 'Technical SEO'), 'Technical SEO');
});

test('a pillar plan links one row and keeps chores as subtasks', () => {
    const plan = planPillarFromItems([
        item({ id: 'a', title: 'Connect Search Console', description: 'Read access', priority: 'high', assigneeId: 'abel' }),
        item({ id: 'b', title: 'Connect Analytics', priority: 'medium', assigneeId: 'abel', estimatedHours: 0.25 }),
        item({ id: 'c', title: 'Already linked', taskId: 'task-1', assigneeId: 'abel' }),
    ], '  SEO Setup  ');

    assert.ok(plan);
    assert.equal(plan?.title, 'SEO Setup');
    assert.equal(plan?.stepKey, 'setup');
    assert.equal(plan?.priority, 'high');
    assert.deepEqual(plan?.assigneeIds, ['abel']);
    assert.equal(plan?.estimatedHours, 0.25);
    assert.equal(plan?.roadmapPhase, 'onboarding');
    assert.deepEqual(plan?.subtasks, [
        { title: 'Connect Search Console', description: 'Read access' },
        { title: 'Connect Analytics' },
    ]);
    assert.deepEqual(plan?.retireItemIds, ['a', 'b']);
    assert.match(plan?.description ?? '', /do not each need a plan row/);
    assert.equal(planPillarFromItems([item()], 'SEO Setup'), null);
});

test('linked setup tasks nest under one pillar and keep their task ids', () => {
    const setup = (id: string, title: string, taskId: string, extra: Partial<MarketingPlanItem> = {}) => item({
        id,
        title,
        taskId,
        assigneeId: 'abel',
        linkedTask: {
            id: taskId,
            organizationId: 'o1',
            clientId: 'c1',
            title,
            assignees: [],
            assigneeIds: ['abel'],
            priority: 'medium',
            status: 'todo',
            tags: [],
            subtasks: [],
            estimatedHours: 0.25,
            basecampTodoId: Number(taskId.replace(/\D/g, '')) || 100,
        },
        ...extra,
    });
    const consoleTask = setup('a', 'Connect Search Console', 'task-11');
    const analytics = setup('b', 'Connect Analytics', 'task-12');
    const roadmap = item({
        id: 'c',
        title: 'Create SEO Roadmap & Recommendations List',
        taskId: 'task-13',
        assigneeId: 'abel',
        linkedTask: {
            id: 'task-13',
            organizationId: 'o1',
            clientId: 'c1',
            title: 'Create SEO Roadmap & Recommendations List',
            assignees: [],
            assigneeIds: ['abel'],
            priority: 'high',
            status: 'todo',
            tags: [],
            subtasks: [],
            estimatedHours: 4,
            basecampTodoId: 9003,
        },
    });
    const alreadyNested = setup('d', 'Already nested', 'task-14', {
        linkedTask: {
            id: 'task-14',
            organizationId: 'o1',
            clientId: 'c1',
            title: 'Already nested',
            assignees: [],
            assigneeIds: ['abel'],
            priority: 'medium',
            status: 'todo',
            tags: [],
            subtasks: [],
            parentTaskId: 'pillar',
        },
    });

    const eligible = itemsEligibleForPillarNest([consoleTask, analytics, roadmap, alreadyNested, item({ id: 'e', title: 'Unlinked' })]);
    assert.deepEqual(eligible.map(row => row.id), ['a', 'b', 'c']);
    assert.deepEqual(defaultNestSelection(eligible), ['a', 'b']);

    const chosen = eligible.filter(row => defaultNestSelection(eligible).includes(row.id))
        .flatMap(row => {
            const candidate = nestCandidateFromPlanItem(row);
            return candidate ? [candidate] : [];
        });
    const plan = planNestUnderPillar(chosen, 'SEO Setup');
    assert.ok(plan);
    assert.equal('subtasks' in (plan ?? {}), false);
    assert.deepEqual(plan?.childTaskIds, ['task-11', 'task-12']);
    assert.deepEqual(plan?.retireItemIds, ['a', 'b']);
    assert.deepEqual(plan?.preservedBasecampTodoIds, ['11', '12']);
    assert.equal(plan?.title, SEO_SETUP_PILLAR_TITLE);
    assert.equal(plan?.estimatedHours, 0.5);
    assert.match(plan?.description ?? '', /keep their history and Basecamp links/);

    const withRoadmap = planNestUnderPillar([
        ...chosen,
        nestCandidateFromPlanItem(roadmap)!,
    ], 'SEO Setup');
    assert.deepEqual(withRoadmap?.childTaskIds, ['task-11', 'task-12', 'task-13']);
    assert.deepEqual(withRoadmap?.retireItemIds, ['a', 'b', 'c']);
    assert.equal(planNestUnderPillar(chosen.slice(0, 1), 'SEO Setup'), null);
    assert.equal(planNestUnderPillar([
        { ...chosen[0], clientId: 'other' },
        chosen[1],
    ], 'SEO Setup'), null);
});
