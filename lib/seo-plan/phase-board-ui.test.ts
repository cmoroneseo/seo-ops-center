import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import { createStageTasks, type StageAddDependencies } from './stage-add-route.ts';
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
        partOfChoices: [{ id: 'site', title: 'Improve the website' }, { id: 'local', title: 'Local visibility' }],
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        today: '2026-10-19',
        initialMonth: '2026-10',
    }));
}

test('both board kinds show empty project groups with add rows', () => {
    for (const board of ['phases', 'months'] as const) {
        const html = render([], board);
        assert.match(html, new RegExp(`data-plan-board="${board}"`));
        assert.deepEqual([...html.matchAll(/data-plan-section="([^"]+)"/g)].map(match => match[1]), [
            'site', 'local', 'no-project',
        ]);
        for (const title of ['Improve the website', 'Local visibility', 'No project']) {
            assert.match(html, new RegExp(`aria-label="Add a task to ${title}"`));
            assert.match(html, new RegExp(`aria-label="Add from a playbook to ${title}"`));
        }
        assert.doesNotMatch(html, /Foundation|Growth|Scale|Onboarding|Backlog/);
    }
});

test('legacy stages do not affect project placement', () => {
    const html = render([
        task({ id: 'crawl', title: 'Crawl the site', stage: 'growth', initiativeId: 'site' }),
        task({ id: 'kickoff', title: 'Kickoff call', stage: 'onboarding', initiativeId: 'site' }),
        task({ id: 'later', title: 'Later cleanup', stage: 'backlog' }),
    ]);
    const site = html.slice(html.indexOf('data-plan-section="site"'), html.indexOf('data-plan-section="local"'));
    assert.match(site, /Crawl the site/);
    assert.match(site, /Kickoff call/);
    assert.match(html.slice(html.indexOf('data-plan-section="no-project"')), /Later cleanup/);
    assert.match(html, /data-plan-month-control/);
});

test('quick-add writes the selected project and keeps the phase default', async () => {
    const initiativeId = '208dbc36-3333-4111-8111-111111111111';
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
        loadProject: async (_org, _client, id) => id === initiativeId,
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
    const added = await createStageTasks(clientId, { stage: 'foundation', initiativeId, titles: ['Write the service page'] }, dependencies);
    assert.equal(added.status, 200);
    assert.equal(rows[0]?.stage, 'foundation');
    assert.equal(rows[0]?.initiative_id, initiativeId);
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

    const monthProject = await createStageTasks(clientId, {
        stage: 'backlog',
        initiativeId,
        items: [{ title: 'Review the new page', depth: 0 }, { title: 'Check the heading', depth: 1 }],
        dueDate: '2026-10-31',
    }, dependencies);
    assert.equal(monthProject.status, 200);
    assert.equal(rows[2]?.initiative_id, initiativeId);
    assert.equal(rows[2]?.stage, 'backlog');
    assert.equal(rows[2]?.due_date, '2026-10-31');
    assert.equal(rows[3]?.initiative_id ?? null, null);

    const noProject = await createStageTasks(clientId, {
        stage: 'foundation', initiativeId: null, titles: ['Check analytics'],
    }, dependencies);
    assert.equal(noProject.status, 200);
    assert.equal(rows[4]?.initiative_id, null);

    const otherClient = await createStageTasks(clientId, {
        stage: 'foundation', initiativeId: clientId, titles: ['Do not add'],
    }, dependencies);
    assert.equal(otherClient.status, 404);
    assert.equal(rows.length, 5);

    const rejected = await createStageTasks(clientId, { stage: 'month_4', titles: ['Nope'] }, dependencies);
    assert.equal(rejected.status, 400);
    if (rejected.status !== 200) assert.equal(rejected.body.error, 'Choose a stage.');
});
