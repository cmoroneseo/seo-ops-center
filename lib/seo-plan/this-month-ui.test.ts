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
    task({ id: 'setup', title: 'SEO Setup', initiativeId: 'setup-project', stage: 'onboarding', position: 1 }),
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
        status: 'todo',
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

function render(today: string, month: string) {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks,
        partOfChoices: [{ id: 'setup-project', title: 'Setup' }],
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        today,
        initialMonth: month,
    }));
}

function section(html: string, id: string): string {
    const start = html.indexOf(`data-plan-section="${id}"`);
    assert.ok(start > 0, id);
    const next = html.indexOf('data-plan-section=', start + 10);
    return html.slice(start, next === -1 ? undefined : next);
}

test('project groups keep subtasks together and show late due dates', () => {
    const html = render('2026-10-31', '2026-10');
    assert.match(html, /data-plan-month="2026-10"/);
    assert.match(html, /October 2026/);
    assert.doesNotMatch(html, /Overdue|data-overdue|emerald|text-green|#22c55e/);
    assert.doesNotMatch(html, /Month 1|Month 2|Month 3|data-stage="month_/);

    const project = section(html, 'setup-project');
    for (const title of ['SEO Setup', 'Add keywords', 'Review robots', 'Set cookies']) {
        assert.match(project, new RegExp(title));
    }
    assert.match(project, /data-plan-due="Oct 31"/);
    assert.match(project, /data-late="true"[\s\S]*data-plan-due="Sep 15 46d late"/);
    assert.match(project, /text-\[#dc2626\]/);

    const unassigned = section(html, 'no-project');
    assert.match(unassigned, /data-task-id="sitemap"/);
    assert.match(unassigned, /data-late="true"/);
    assert.match(unassigned, /data-plan-due="Oct 4 27d late"/);
    assert.match(unassigned, /text-\[#dc2626\]/);
    assert.match(unassigned, /Create roadmap|November audit/);
    assert.doesNotMatch(unassigned, /Set cookies/);
    assert.match(html, /data-task-id="setup"[\s\S]*data-stage-drag="task"/);
    assert.match(html, /data-task-id="sitemap"[\s\S]*data-stage-drag="task"/);
});

test('changing the reporting month keeps the same project groups and tasks', () => {
    for (const month of ['2026-09', '2026-11']) {
        const html = render('2026-10-31', month);
        assert.match(html, new RegExp(`data-plan-month="${month}"`));
        assert.match(section(html, 'setup-project'), /Set cookies/);
        const unassigned = section(html, 'no-project');
        for (const title of ['Fix sitemap', 'November audit', 'Create roadmap']) {
            assert.match(unassigned, new RegExp(title));
        }
        assert.match(unassigned, /data-task-id="done"/);
        assert.match(html, /data-plan-footer/);
    }
});
