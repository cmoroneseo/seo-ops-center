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

test('the current month keeps onboarding together and lists late work in This month', () => {
    const html = render('2026-10-31', '2026-10');
    assert.match(html, /data-plan-month="2026-10"/);
    assert.match(html, /October 2026/);
    assert.doesNotMatch(html, /Overdue|data-overdue|emerald|text-green|#22c55e/);
    assert.doesNotMatch(html, /Month 1|Month 2|Month 3|data-stage="month_/);

    const onboarding = section(html, 'onboarding');
    for (const title of ['SEO Setup', 'Add keywords', 'Review robots', 'Set cookies']) {
        assert.match(onboarding, new RegExp(title));
    }
    assert.match(onboarding, /data-plan-due="Oct 31"/);
    assert.match(onboarding, /data-late="true"[\s\S]*data-plan-due="Sep 15 46d late"/);
    assert.match(onboarding, /text-\[#f87171\]/);

    const month = section(html, 'this_month');
    assert.match(month, /data-task-id="sitemap"/);
    assert.match(month, /data-late="true"/);
    assert.match(month, /data-plan-due="Oct 4 27d late"/);
    assert.match(month, /text-\[#f87171\]/);
    assert.doesNotMatch(month, /Create roadmap|November audit|Done this month|Set cookies/);

    const backlog = section(html, 'backlog');
    assert.match(backlog, /data-plan-collapsed="true"/);
    assert.match(backlog, /Create roadmap/);
    assert.match(backlog, /November audit/);
    assert.match(html, /data-task-id="setup"[\s\S]*data-stage-drag="task"/);
    assert.match(html, /data-task-id="sitemap"[\s\S]*data-stage-drag="task"/);
});

test('a past month is a look-back and does not copy open work', () => {
    const html = render('2026-10-31', '2026-09');
    assert.match(html, /data-plan-month="2026-09"/);
    assert.match(html, /September 2026/);
    assert.match(html, /look-back: open work stays in This month/);
    assert.match(html, /Nothing was due or completed in September\./);
    assert.doesNotMatch(section(html, 'this_month'), /Fix sitemap|November audit|Create roadmap/);
    assert.match(section(html, 'onboarding'), /Set cookies/);
    assert.match(section(html, 'backlog'), /Create roadmap/);
    assert.match(section(html, 'backlog'), /November audit/);
    assert.doesNotMatch(html, /Fix sitemap/);
});

test('a future month shows what is due then, and the new current month carries late work', () => {
    const ahead = render('2026-10-31', '2026-11');
    assert.match(ahead, /November 2026/);
    assert.match(section(ahead, 'this_month'), /November audit/);
    assert.match(section(ahead, 'this_month'), /data-plan-due="Nov 1"/);
    assert.doesNotMatch(section(ahead, 'this_month'), /Fix sitemap|Set cookies|Create roadmap/);
    assert.match(section(ahead, 'onboarding'), /Set cookies/);
    assert.match(section(ahead, 'backlog'), /Create roadmap/);
    assert.doesNotMatch(ahead, /Fix sitemap/);

    const november = render('2026-11-01', '2026-11');
    const month = section(november, 'this_month');
    assert.match(month, /November audit/);
    assert.match(month, /data-plan-due="Nov 1"/);
    const audit = month.slice(month.indexOf('data-task-id="audit"'), month.indexOf('data-task-id="audit"') + 900);
    assert.doesNotMatch(audit, /data-late="true"/);
    assert.match(month, /Fix sitemap/);
    assert.match(month, /data-plan-due="Oct 4 28d late"/);
    assert.match(section(november, 'onboarding'), /data-plan-due="Oct 31 1d late"/);
    assert.match(section(november, 'onboarding'), /Set cookies/);
    assert.doesNotMatch(november, /Done this month/);
    assert.match(section(november, 'backlog'), /Create roadmap/);
});
