import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

const tasks: StageListTask[] = [
    task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', position: 1 }),
    task({
        id: 'keywords',
        title: 'Add keywords',
        stage: 'onboarding',
        parentTaskId: 'setup',
        position: 1,
        dueDate: '2026-10-31',
    }),
    task({
        id: 'robots',
        title: 'Review robots',
        stage: 'onboarding',
        parentTaskId: 'setup',
        position: 2,
        status: 'blocked',
        dueDate: '2026-09-15',
    }),
    task({
        id: 'cookies',
        title: 'Set cookies',
        stage: 'onboarding',
        parentTaskId: 'setup',
        position: 3,
        dueDate: '2026-11-02',
    }),
    task({ id: 'roadmap', title: 'Create roadmap', stage: 'backlog', position: 1 }),
    task({ id: 'sitemap', title: 'Fix sitemap', stage: 'backlog', position: 2, dueDate: '2026-10-04' }),
    task({ id: 'audit', title: 'November audit', stage: 'backlog', position: 3, dueDate: '2026-11-01' }),
    task({ id: 'done', title: 'Done this month', stage: 'backlog', position: 4, status: 'done', dueDate: '2026-10-10' }),
];

function render(thisMonth: boolean, today: string) {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks,
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        thisMonth,
        today,
    }));
}

test('This month starts off and lists every stage without an overdue mark', () => {
    const html = render(false, '2026-10-31');
    assert.match(html, /data-this-month="off"/);
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, />This month</);
    for (const title of ['SEO Setup', 'Add keywords', 'Review robots', 'Set cookies', 'Create roadmap', 'Fix sitemap', 'November audit', 'Done this month']) {
        assert.match(html, new RegExp(title));
    }
    assert.doesNotMatch(html, /Overdue|data-overdue/);
    assert.doesNotMatch(html, /Month 1|Month 2|Month 3|data-stage="month_/);
    assert.match(html, /data-stage="onboarding"[\s\S]*data-stage-drag="task"/);
    assert.match(html, /data-task-id="sitemap"[\s\S]*data-stage-drag="task"/);
});

test('This month keeps open work due this month and overdue work, under its pillar', () => {
    const html = render(true, '2026-10-31');
    assert.match(html, /data-this-month="on"/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /data-stage="onboarding"/);
    assert.match(html, /data-stage="backlog"/);
    assert.match(html, /data-stage-role="task" data-task-id="setup"/);
    assert.match(html, /data-stage-role="subtask" data-task-id="keywords"/);
    assert.match(html, /data-stage-role="subtask" data-task-id="robots"/);
    assert.match(html, /data-task-id="sitemap"/);
    assert.doesNotMatch(html, /Set cookies|Create roadmap|November audit|Done this month/);
    assert.match(html, /data-task-id="robots"[\s\S]*data-overdue="true"[^>]*>Overdue · Sep 15</);
    assert.match(html, /data-task-id="sitemap"[\s\S]*data-overdue="true"[^>]*>Overdue · Oct 4</);
    const keywords = html.slice(html.indexOf('data-task-id="keywords"'), html.indexOf('data-task-id="robots"'));
    assert.match(keywords, />Oct 31</);
    assert.doesNotMatch(keywords, /Overdue|data-overdue/);
    assert.match(html, /data-task-id="setup"[\s\S]*data-stage-drag="task"/);
    assert.match(html, /data-task-id="sitemap"[\s\S]*data-stage-drag="task"/);
    assert.match(html, /Add task to Onboarding/);
    assert.match(html, /Add task to Backlog/);
});

test('the calendar month boundary moves last month into overdue and admits the new month', () => {
    const html = render(true, '2026-11-01');
    assert.match(html, /November audit/);
    assert.match(html, /Set cookies/);
    assert.doesNotMatch(html, /Create roadmap|Done this month/);
    assert.match(html, /data-task-id="keywords"[\s\S]*data-overdue="true"[^>]*>Overdue · Oct 31</);
    assert.match(html, /data-task-id="sitemap"[\s\S]*data-overdue="true"[^>]*>Overdue · Oct 4</);
    const audit = html.slice(html.indexOf('data-task-id="audit"'), html.indexOf('data-task-id="audit"') + 1600);
    assert.match(audit, />Nov 1</);
    assert.doesNotMatch(audit, /Overdue/);
});
