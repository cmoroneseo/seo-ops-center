import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { DoneThisMonthLog } from './done-this-month.ts';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: null,
        parentTaskId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const tasks: StageListTask[] = [
    task({
        id: 'citations',
        title: 'Citations cleanup',
        status: 'done',
        completedAt: '2026-10-20T18:00:00.000Z',
    }),
    task({ id: 'yelp-sub', title: 'Yelp citation', parentTaskId: 'citations', status: 'todo' }),
    task({
        id: 'yelp',
        title: 'Yelp',
        status: 'done',
        completedAt: '2026-10-08T17:00:00.000Z',
        publishedUrl: 'https://yelp.com/biz/mayas-construction-austin',
    }),
    task({
        id: 'bbb',
        title: 'BBB',
        status: 'done',
        completedAt: '2026-10-09T17:00:00.000Z',
        publishedUrl: 'https://bbb.org/us/tx/austin/profile/mayas-construction',
    }),
    task({
        id: 'angi',
        title: 'Angi',
        status: 'done',
        completedAt: '2026-10-12T17:00:00.000Z',
        publishedUrl: 'https://angi.com/companylist/us/tx/austin/mayas-construction',
    }),
    task({
        id: 'bathroom',
        title: 'Bathroom page',
        status: 'done',
        completedAt: '2026-10-16T20:00:00.000Z',
        publishedUrl: 'https://mayasconstruction.com/bathroom-remodeling',
    }),
    task({
        id: 'kickoff',
        title: 'Kickoff call recap',
        stage: 'onboarding',
        status: 'done',
        completedAt: '2026-10-02T17:00:00.000Z',
    }),
];

const logs: DoneThisMonthLog[] = [
    { clientId: 'maya', hours: 4.5, countsTowardBudget: true, date: '2026-10-16', status: 'logged' },
    { clientId: 'maya', hours: 0.5, countsTowardBudget: false, date: '2026-10-16', status: 'logged' },
    { clientId: 'maya', hours: 2, countsTowardBudget: true, date: '2026-10-16', status: 'in_progress' },
];

function render(extra: Partial<React.ComponentProps<typeof StagePlanListView>> = {}) {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks,
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        today: '2026-10-19',
        initialMonth: '2026-10',
        clientId: 'maya',
        monthLogs: logs,
        onOpenResults: () => undefined,
        ...extra,
    }));
}

function footer(html: string): string {
    const start = html.indexOf('data-plan-footer');
    assert.ok(start > 0);
    return html.slice(start);
}

test('the footer shows completed leaves, URL chips, and billable hours', () => {
    const html = footer(render());
    assert.match(html, /Done this month/);
    assert.match(html, /October 2026 · tasks completed and time logged in Oct/);
    assert.match(html, /Open in Results →/);
    assert.match(html, /data-plan-completed="5"/);
    assert.match(html, /data-plan-urls="4"/);
    assert.match(html, /data-plan-hours="4\.5h"/);
    assert.match(html, /title="4\.5h billable · 5\.0h total logged \(0\.5h non-billable\)"/);
    assert.match(html, /logged · running timer adds on stop/);
    assert.match(html, /yelp\.com\/biz\/mayas-construction-austin/);
    assert.match(html, /bbb\.org\/us\/tx\/austin\/profile\/mayas-construction/);
    assert.match(html, /angi\.com\/companylist\/us\/tx\/austin\/mayas-construction/);
    assert.match(html, /mayasconstruction\.com\/bathroom-remodeling/);
    assert.match(html, /data-plan-missing-urls="1"/);
    assert.match(html, /\+1 without a URL/);
    assert.doesNotMatch(html, /Citations cleanup/);
    assert.doesNotMatch(html, /emerald|text-green|#22c55e|#16a34a|of \d+h|retainer/i);
    assert.equal(html.indexOf('data-plan-completed="5"') < html.indexOf('data-zero="false"'), true);
});

test('zeros stay muted and the empty sentence names the month', () => {
    const html = footer(render({
        tasks: [task({ id: 'open', title: 'Still open' })],
        monthLogs: [],
    }));
    assert.match(html, /data-plan-completed="0"[^>]*data-zero="true"/);
    assert.match(html, /data-plan-urls="0"[^>]*data-zero="true"/);
    assert.match(html, /data-plan-hours="0\.0h"[^>]*data-zero="true"/);
    assert.match(html, /text-\[#8b8b93\]/);
    assert.match(html, /Nothing completed in October yet\./);
    assert.doesNotMatch(html, /data-zero="false"|emerald|text-green|#22c55e|#16a34a/);
    assert.doesNotMatch(html, /data-plan-url=/);
});
