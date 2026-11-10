import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import { createStageTasks, type StageAddDependencies } from './stage-add-route.ts';
import { PHASE_STAGE_COPY } from './plan-phases.ts';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

function render(tasks: StageListTask[], board: 'phases' | 'months' = 'months') {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks,
        board,
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        today: '2026-10-19',
        initialMonth: '2026-10',
    }));
}

test('a new phase plan shows three empty stages and an add box on each', () => {
    const html = render([], 'phases');
    assert.match(html, /data-plan-board="phases"/);
    assert.match(html, /This plan has no tasks yet/);
    for (const phase of ['foundation', 'growth', 'scale'] as const) {
        assert.match(html, new RegExp(`data-plan-section="${phase}"`));
        assert.match(html, new RegExp(`data-add="${phase}"`));
        assert.match(html, new RegExp(PHASE_STAGE_COPY[phase].description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.equal(html.match(/data-add="(?:foundation|growth|scale)"/g)?.length, 3);
    assert.doesNotMatch(html, /data-plan-month-control|data-plan-add="true"|data-plan-section="onboarding"|data-plan-section="this_month"|data-plan-footer|Done this month/);
    assert.doesNotMatch(html, /Month 1|Month 2|Month 3/);
});

test('an existing month plan still shows Onboarding, This month, and Backlog', () => {
    const html = render([
        task({ id: 'crawl', title: 'Crawl the site', stage: 'month_1', dueDate: '2026-10-12' }),
        task({ id: 'kickoff', title: 'Kickoff call', stage: 'onboarding' }),
        task({ id: 'later', title: 'Later cleanup', stage: 'backlog' }),
    ]);
    assert.match(html, /data-plan-board="months"/);
    assert.match(html, /data-plan-section="onboarding"[\s\S]*Kickoff call/);
    assert.match(html, /data-plan-section="this_month"[\s\S]*Crawl the site/);
    assert.match(html, /data-plan-section="backlog"[\s\S]*Later cleanup/);
    assert.match(html, /data-plan-month-control/);
    assert.doesNotMatch(html, /data-plan-section="foundation"|data-add="growth"|Fixing the basics/);
});

test('quick-add writes the phase stage and does not invent a due date', async () => {
    const rows: Record<string, unknown>[] = [];
    const dependencies: StageAddDependencies = {
        session: async () => ({
            ok: true,
            userId: 'user-1',
            organizationId: '06e536b9-beac-49bc-8c96-1df021102590',
            role: 'member',
        }),
        enabled: () => true,
        now: () => '2026-10-16T17:00:00.000Z',
        loadClient: async () => true,
        loadParent: async () => ({ title: 'Fix the sitemap', stage: 'foundation', parentTaskId: null }),
        maxPosition: async () => null,
        insertTasks: async inserted => {
            rows.push(...inserted);
            return inserted.map((row, index) => task({
                id: `saved-${index}`,
                title: String(row.title),
                stage: String(row.stage),
                position: typeof row.position === 'number' ? row.position : 1,
                parentTaskId: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
            }));
        },
    };
    const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';
    const added = await createStageTasks(clientId, { stage: 'growth', titles: ['Write the service page'] }, dependencies);
    assert.equal(added.status, 200);
    assert.equal(rows[0]?.stage, 'growth');
    assert.equal(rows[0]?.title, 'Write the service page');
    assert.equal(rows[0]?.due_date ?? null, null);

    const child = await createStageTasks(clientId, {
        stage: 'scale',
        titles: ['Link the new page'],
        parentTaskId: '208dbc36-1111-4111-8111-111111111111',
    }, dependencies);
    assert.equal(child.status, 200);
    assert.equal(rows[1]?.stage, 'foundation');
    assert.equal(rows[1]?.parent_task_id, '208dbc36-1111-4111-8111-111111111111');

    const rejected = await createStageTasks(clientId, { stage: 'month_4', titles: ['Nope'] }, dependencies);
    assert.equal(rejected.status, 400);
    if (rejected.status !== 200) assert.equal(rejected.body.error, 'Choose a stage.');
});
