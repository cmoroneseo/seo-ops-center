/**
 * Run with: node --import tsx --test lib/reports/roadmap-block.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoadmapReportBlock } from '../../components/reports/RoadmapReportBlock.tsx';
import { RoadmapReportView } from '../../components/reports/RoadmapReportView.tsx';
import { ROADMAP_COPY, projectClientRoadmap } from './roadmap.ts';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import type { Block } from './blocks.ts';
import type { ClientProject } from '../types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'foundation',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const roadmap = projectClientRoadmap({
    projects: [{ id: 'site', title: 'Site improvements', state: 'in_progress' }],
    tasks: [
        task({
            id: 'fix',
            initiativeId: 'site',
            title: 'Fix the sitemap',
            status: 'done',
            completedAt: '2026-11-02T20:00:00.000Z',
            description: 'Make the sitemap so Google can read every page.',
        }),
        task({ id: 'page', title: 'Write the service page', stage: 'growth', description: 'A page for the service people search for.' }),
    ],
});

const client = { id: '33333333-3333-4333-8333-333333333333', clientName: 'Northwind', accountManager: '' } as ClientProject;

test('the editor keeps the description toggle and ignores saved stage settings', () => {
    const block: Block = {
        id: 'plan',
        type: 'roadmap',
        props: { settingsOpen: true, hiddenStages: ['foundation', 'growth', 'scale', 'onboarding', 'this_month', 'backlog'], showTaskDescriptions: true },
    };
    const html = renderToStaticMarkup(createElement(RoadmapReportBlock, {
        block,
        ctx: {
            client,
            roadmap,
            roadmapFromServer: true,
            onEditText: () => {},
        },
    }));
    assert.match(html, /data-roadmap-editor/);
    assert.doesNotMatch(html, /Stages to show/);
    assert.match(html, new RegExp(ROADMAP_COPY.showDescriptions));
    assert.match(html, /Site improvements/);
    assert.match(html, /Fix the sitemap/);
    assert.match(html, /Done on Nov 2/);
    assert.match(html, /Make the sitemap so Google can read every page/);
    assert.match(html, /Write the service page/);
    assert.match(html, /Other work/);
    assert.match(html, /aria-hidden="true"|type="checkbox"/);
});

test('a shared report with no roadmap data hides the block', () => {
    const block: Block = { id: 'plan', type: 'roadmap', props: {} };
    const html = renderToStaticMarkup(createElement(RoadmapReportBlock, {
        block,
        ctx: { client, roadmap: null, roadmapFromServer: true },
    }));
    assert.equal(html.includes(ROADMAP_COPY.error), false);
    assert.equal(html.includes('data-roadmap-block'), false);
    assert.equal(html, '');
});

test('the public view has no settings and no staff fields', () => {
    const html = renderToStaticMarkup(createElement(RoadmapReportView, { roadmap }));
    assert.match(html, /data-roadmap-block/);
    assert.match(html, new RegExp(ROADMAP_COPY.title));
    assert.equal(html.includes('data-roadmap-editor'), false);
    assert.equal(html.includes('Show task descriptions'), false);
    assert.equal(html.includes('abel@'), false);
    assert.equal(html.includes('hours'), false);
    assert.match(html, /1 of 1 done/);
});

test('a published report offers a link anyone can open without logging in', () => {
    const html = renderToStaticMarkup(createElement(RoadmapReportBlock, {
        block: { id: 'plan', type: 'roadmap', props: {} },
        ctx: {
            client,
            roadmap,
            roadmapFromServer: true,
            onEditText: () => {},
            reportId: '66666666-6666-4666-8666-666666666666',
            reportStatus: 'published',
        },
    }));
    assert.match(html, /Share roadmap link/);
    assert.match(html, /Anyone with this link can see the live plan for this client\. No login needed\./);
});

test('a draft report and a client view do not offer that link', () => {
    const draft = renderToStaticMarkup(createElement(RoadmapReportBlock, {
        block: { id: 'plan', type: 'roadmap', props: {} },
        ctx: {
            client,
            roadmap,
            roadmapFromServer: true,
            onEditText: () => {},
            reportId: '66666666-6666-4666-8666-666666666666',
            reportStatus: 'draft',
        },
    }));
    assert.equal(draft.includes('Share roadmap link'), false);
    assert.match(draft, /Approve the report, or share it with the client, to create a link/);

    const clientView = renderToStaticMarkup(createElement(RoadmapReportBlock, {
        block: { id: 'plan', type: 'roadmap', props: {} },
        ctx: {
            client,
            roadmap,
            roadmapFromServer: true,
            clientFacing: true,
            reportId: '66666666-6666-4666-8666-666666666666',
            reportStatus: 'published',
        },
    }));
    assert.equal(clientView.includes('Share roadmap link'), false);
    assert.equal(clientView.includes('No login needed'), false);
});

test('an empty plan says no work has been planned yet', () => {
    const empty = projectClientRoadmap({ projects: [{ id: 'site', title: 'Site improvements', state: 'planned' }], tasks: [] });
    const html = renderToStaticMarkup(createElement(RoadmapReportView, { roadmap: empty }));
    assert.match(html, new RegExp(ROADMAP_COPY.empty));
    assert.match(html, /Site improvements/);
    assert.match(html, /Planned/);
    assert.doesNotMatch(html, /Other work/);
    assert.equal(html.includes('data-roadmap-task'), false);
});

test('the roadmap view renders a legacy snapshot', () => {
    const html = renderToStaticMarkup(createElement(RoadmapReportView, {
        roadmap: { stages: [{
            id: 'foundation',
            title: 'Foundation',
            description: 'Old group description',
            done: 1,
            total: 1,
            progress: '1 of 1 done',
            tasks: [{ title: 'Fix the sitemap', status: 'Done', doneOn: 'Nov 2' }],
        }] },
    }));
    assert.match(html, /Foundation/);
    assert.match(html, /Fix the sitemap/);
    assert.match(html, /1 of 1 done/);
    assert.doesNotMatch(html, /Old group description|data-roadmap-stage/);
});
