import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StageAddBar } from '../../components/seo-plan/StageAddBar.tsx';
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
    task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', position: 1 }),
    task({
        id: 'keywords',
        title: 'Add keywords to Position tracking',
        stage: 'onboarding',
        position: 1,
        parentTaskId: 'setup',
    }),
    task({ id: 'robots', title: 'Review robots.txt', stage: 'backlog', position: 1 }),
    task({ id: 'pending:draft', title: 'Saving this title', stage: 'backlog', position: 2 }),
];

function render(query = '') {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks,
        query,
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        clientName: 'Floor Co Design USA',
    }));
}

test('every stage section has an add bar, including an empty stage', () => {
    const html = render();
    for (const [stage, label] of [
        ['onboarding', 'Onboarding'],
        ['backlog', 'Backlog'],
    ] as const) {
        assert.match(html, new RegExp(`data-stage-add="${stage}"[\\s\\S]*?aria-label="Add task to ${label}"`));
        assert.match(html, new RegExp(`data-add="${stage}"`));
    }
    assert.match(html, /placeholder="Add a task…"/);
    assert.doesNotMatch(html, /Month 1|Month 2|Month 3|data-stage="month_|Template library|data-lib/);
});

test('an expanded pillar accepts a subtask, and a collapsed pillar does not', () => {
    const open = render();
    const children = open.slice(open.indexOf('data-stage-children="setup"'), open.indexOf('data-task-id="robots"'));
    assert.match(children, /aria-label="Add subtask to SEO Setup"/);
    assert.match(children, /data-add="onboarding"/);
    assert.match(children, /data-add-parent="setup"/);
    assert.match(children, /placeholder="Add a subtask…"/);

    const collapsed = render('seo setup');
    assert.match(collapsed, /aria-expanded="false"/);
    assert.doesNotMatch(collapsed, /Add subtask to SEO Setup/);
    assert.doesNotMatch(collapsed, /data-add-parent="setup"/);
    assert.match(collapsed, /aria-label="Add task to Onboarding"/);
});

test('a pending row is visible and cannot be opened', () => {
    const html = render();
    assert.match(html, /data-pending="true"[^>]*data-task-id="pending:draft"|data-task-id="pending:draft"[^>]*data-pending="true"/);
    const row = html.slice(html.indexOf('data-task-id="pending:draft"') - 80, html.indexOf('Saving this title') + 40);
    assert.match(row, /disabled=""/);
    assert.match(html, /Saving this title/);
});

test('the add bar renders a labeled field and no template control', () => {
    const html = renderToStaticMarkup(createElement(StageAddBar, {
        label: 'Add task to Backlog',
        placeholder: 'Add a task…',
        stage: 'backlog',
        onAdd: async () => undefined,
    }));
    assert.match(html, /aria-label="Add task to Backlog"/);
    assert.match(html, /data-add="backlog"/);
    assert.match(html, /placeholder="Add a task…"/);
    assert.doesNotMatch(html, /data-add-parent|Template library|type="submit"/);
});
