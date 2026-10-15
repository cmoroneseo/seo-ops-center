/**
 * Run with: node --import tsx --test lib/marketing-plan-nest-pillar-panel.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NestUnderPillarPanel } from '../components/marketing-plan/NestUnderPillarPanel.tsx';
import { ExecutionWorkspace } from '../components/marketing-plan/ExecutionWorkspace.tsx';
import type { MarketingPlan, MarketingPlanItem, Task } from './types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function task(id: string, title: string, hours: number): Task {
    return {
        id, organizationId: 'o1', clientId: 'c1', title, assignees: [], assigneeIds: ['abel'],
        priority: 'medium', status: 'todo', tags: [], subtasks: [], estimatedHours: hours,
        basecampTodoId: 8000 + hours,
    };
}

function item(over: Partial<MarketingPlanItem>): MarketingPlanItem {
    return {
        id: 'i1', marketingPlanId: 'p1', organizationId: 'o1', clientId: 'c1',
        stepKey: 'setup', title: 'Connect Search Console', status: 'todo', priority: 'medium',
        sortOrder: 0, comments: [], isCustom: false, roadmapIncluded: true, roadmapPhase: 'onboarding',
        taskId: 'task-1',
        createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
        ...over,
    };
}

test('nest panel checks short setup chores and leaves the roadmap deliverable unchecked', () => {
    const html = renderToStaticMarkup(createElement(NestUnderPillarPanel, {
        scopeLabel: 'Linked tasks',
        items: [
            item({ id: 'a', title: 'Connect Search Console', taskId: 'task-11', linkedTask: task('task-11', 'Connect Search Console', 0.25) }),
            item({ id: 'b', title: 'Connect Analytics', taskId: 'task-12', linkedTask: task('task-12', 'Connect Analytics', 0.25) }),
            item({
                id: 'c',
                title: 'Create SEO Roadmap & Recommendations List',
                taskId: 'task-13',
                linkedTask: task('task-13', 'Create SEO Roadmap & Recommendations List', 4),
            }),
        ],
        creating: false,
        onConfirm: () => {},
        onClose: () => {},
    }));
    assert.match(html, /Nest under pillar — Linked tasks/);
    assert.match(html, /history and Basecamp link/);
    assert.match(html, /value="SEO Setup"/);
    assert.match(html, /Group 2 under SEO Setup/);
    assert.match(html, /aria-label="Nest Connect Search Console"[^>]*checked/);
    assert.match(html, /aria-label="Nest Connect Analytics"[^>]*checked/);
    assert.match(html, /aria-label="Nest Create SEO Roadmap &amp; Recommendations List"/);
    assert.doesNotMatch(html, /aria-label="Nest Create SEO Roadmap &amp; Recommendations List"[^>]*checked/);
});

test('the SEO Plan offers nest when two linked tasks are available', () => {
    const plan: MarketingPlan = {
        id: 'plan', organizationId: 'org', clientId: 'client', title: 'Plan',
        steps: [], createdAt: '2026-10-01', updatedAt: '2026-10-01', items: [],
    };
    const shown = renderToStaticMarkup(createElement(ExecutionWorkspace, {
        plan,
        month: '2026-10',
        budget: 10,
        loggedHours: 0,
        taskHours: {},
        members: [],
        fullPlan: createElement('p', null, 'Roadmap'),
        onAddExisting: () => {},
        onMonthChange: () => {},
        onSaveTask: async () => {},
        onSchedule: async () => {},
        onSaveGoal: async () => {},
        onOpenTask: () => {},
        nestLinkedCount: 3,
        onNestLinked: () => {},
    }));
    assert.match(shown, /Nest under pillar/);
    const hidden = renderToStaticMarkup(createElement(ExecutionWorkspace, {
        plan,
        month: '2026-10',
        budget: 10,
        loggedHours: 0,
        taskHours: {},
        members: [],
        fullPlan: createElement('p', null, 'Roadmap'),
        onAddExisting: () => {},
        onMonthChange: () => {},
        onSaveTask: async () => {},
        onSchedule: async () => {},
        onSaveGoal: async () => {},
        onOpenTask: () => {},
        readOnly: true,
        nestLinkedCount: 3,
        onNestLinked: () => {},
    }));
    assert.equal(hidden.includes('Nest under pillar'), false);
});

test('All client tasks can open the same nest panel', () => {
    const page = readFileSync(new URL('../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /NestLinkedTasksControl/);
    assert.match(page, /actorName=\{displayName\}/);
});
