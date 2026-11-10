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
    board: 'phases',
    today: '2026-11-10',
    tasks: [
        task({
            id: 'fix',
            title: 'Fix the sitemap',
            status: 'done',
            completedAt: '2026-11-02T20:00:00.000Z',
            description: 'Make the sitemap so Google can read every page.',
        }),
        task({ id: 'page', title: 'Write the service page', stage: 'growth', description: 'A page for the service people search for.' }),
    ],
});

const client = { id: '33333333-3333-4333-8333-333333333333', clientName: 'Northwind', accountManager: '' } as ClientProject;

test('the editor shows stage choices and the description toggle, and hides a stage', () => {
    const block: Block = {
        id: 'plan',
        type: 'roadmap',
        props: { settingsOpen: true, hiddenStages: ['growth'], showTaskDescriptions: true },
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
    assert.match(html, new RegExp(ROADMAP_COPY.stagesToShow));
    assert.match(html, new RegExp(ROADMAP_COPY.showDescriptions));
    assert.match(html, /Foundation/);
    assert.match(html, /Fix the sitemap/);
    assert.match(html, /Done on Nov 2/);
    assert.match(html, /Make the sitemap so Google can read every page/);
    assert.equal(html.includes('Write the service page'), false);
    assert.equal(html.includes('Growth'), true);
    assert.match(html, /aria-hidden="true"|type="checkbox"/);
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

test('an empty plan says no work has been planned yet', () => {
    const empty = projectClientRoadmap({ board: 'phases', tasks: [], today: '2026-11-10' });
    const html = renderToStaticMarkup(createElement(RoadmapReportView, { roadmap: empty }));
    assert.match(html, new RegExp(ROADMAP_COPY.empty));
    assert.match(html, /Foundation/);
    assert.match(html, /Growth/);
    assert.match(html, /Scale/);
    assert.equal(html.includes('data-roadmap-task'), false);
});
