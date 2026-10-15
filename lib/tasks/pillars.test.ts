import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketingPlanItem } from '../types.ts';
import {
    defaultPillarTitle,
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
