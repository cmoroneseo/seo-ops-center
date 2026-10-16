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
        position: null,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const tasks: StageListTask[] = [
    task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', position: 1, category: 'admin' }),
    task({
        id: 'keywords',
        title: 'Add keywords to Position tracking',
        stage: 'onboarding',
        position: 2,
        parentTaskId: 'setup',
        basecamp: true,
    }),
    task({
        id: 'cookies',
        title: 'Set Up Empire Cookies',
        stage: 'month_1',
        position: 1,
        parentTaskId: 'setup',
        basecamp: true,
        status: 'done',
    }),
    task({ id: 'roadmap', title: 'Create SEO Roadmap', stage: 'onboarding', position: 2, basecamp: true }),
    task({ id: 'robots', title: 'Review robots.txt and XML sitemap', stage: 'month_1', position: 1, category: 'technical' }),
];

function render(query = '', extraTasks: StageListTask[] = []) {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks: [...tasks, ...extraTasks],
        query,
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        clientName: 'Floor Co Design USA',
    }));
}

test('the list renders every stage, including empty ones, in roadmap order', () => {
    const html = render();
    const headings = ['Onboarding', 'Month 1', 'Month 2', 'Month 3', 'Backlog'];
    let cursor = 0;
    for (const heading of headings) {
        const index = html.indexOf(heading, cursor);
        assert.equal(index > cursor || (cursor === 0 && index === 0) || index > 0, true, heading);
        cursor = index + heading.length;
    }
    assert.match(html, /data-stage="month_2"/);
    assert.match(html, /data-stage="month_3"/);
    assert.match(html, /data-stage="backlog"/);
    assert.equal((html.match(/No tasks/g) ?? []).length, 3);
    assert.match(html, /data-stage="onboarding"[\s\S]*data-count="2"/);
    assert.match(html, /Search tasks for Floor Co Design USA/);
    assert.match(html, /Search all tasks and subtasks/);
    assert.doesNotMatch(html, /draggable/);
});

test('subtasks render under the pillar and not as peer rows', () => {
    const html = render();
    const children = html.slice(html.indexOf('data-stage-children="setup"'), html.indexOf('data-task-id="roadmap"'));
    assert.match(children, /data-stage-role="subtask" data-task-id="cookies"/);
    assert.match(children, /data-stage-role="subtask" data-task-id="keywords"/);
    assert.match(children, /in SEO Setup/);
    assert.match(children, /Basecamp/);
    assert.equal(html.indexOf('data-task-id="cookies"'), html.indexOf('data-task-id="keywords"') === -1
        ? -1
        : html.indexOf('data-task-id="cookies"'));
    assert.ok(html.indexOf('data-task-id="cookies"') < html.indexOf('data-task-id="keywords"'));
    assert.doesNotMatch(html, /data-stage-role="task" data-task-id="cookies"/);
    assert.doesNotMatch(html, /data-stage-role="task" data-task-id="keywords"/);
    assert.match(html, /Pillar · 1\/2/);
    assert.match(html, /aria-expanded="true"/);
});

test('a subtask-only match expands the parent and hides the other subtask', () => {
    const html = render('cookies');
    assert.match(html, /data-stage-role="task" data-task-id="setup"/);
    assert.match(html, /aria-expanded="true" aria-controls="[^"]+" aria-label="Hide 1 subtask of SEO Setup"/);
    assert.match(html, /Set Up Empire /);
    assert.match(html, /<mark[^>]*>Cookies<\/mark>/);
    assert.doesNotMatch(html, /Add keywords to Position tracking/);
    assert.doesNotMatch(html, /Create SEO Roadmap/);
    assert.doesNotMatch(html, /Review robots\.txt/);
    assert.match(html, /data-stage="month_2"[\s\S]*?No tasks/);
    assert.match(html, /data-stage="backlog"[\s\S]*?No tasks/);
});

test('a pillar-only match stays collapsed', () => {
    const html = render('seo setup');
    assert.match(html, /aria-expanded="false" aria-controls="[^"]+" aria-label="Show 2 subtasks of SEO Setup"/);
    assert.doesNotMatch(html, /Set Up Empire Cookies/);
    assert.doesNotMatch(html, /Add keywords to Position tracking/);
    assert.match(html, /SEO Setup/);
});
