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

function render(query = '', initialMonth = '2026-10') {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks,
        query,
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        clientName: 'Floor Co Design USA',
        today: '2026-10-19',
        initialMonth,
    }));
}

test('one add line sits under the plan header and follows the selected month', () => {
    const html = render();
    assert.equal(html.match(/data-plan-add="true"/g)?.length, 1);
    assert.match(html, /data-plan-month="2026-10"/);
    assert.match(html, /placeholder="Add task. Paste a list to add several."/);
    assert.match(html, /data-plan-add-chip="month"/);
    assert.match(html, /data-plan-add-label="Due Oct 31"/);
    assert.match(html, /data-plan-add-due="2026-10-31"/);
    assert.doesNotMatch(html, /data-stage-add|data-add-parent|Add a subtask|Add task to Onboarding|Add task to Backlog/);
    assert.doesNotMatch(html, /Month 1|Month 2|Month 3|data-stage="month_|Template library|data-lib/);
    const headerEnd = html.indexOf('data-plan-add="true"');
    const sections = html.indexOf('data-plan-section="onboarding"');
    assert.ok(headerEnd > 0 && sections > headerEnd);

    const november = render('', '2026-11');
    assert.match(november, /data-plan-month="2026-11"/);
    assert.match(november, /data-plan-add-due="2026-11-30"/);
    assert.match(november, /data-plan-add-label="Due Nov 30"/);
});

test('a collapsed pillar does not grow an add field', () => {
    const collapsed = render('seo setup');
    assert.match(collapsed, /aria-expanded="false"/);
    assert.doesNotMatch(collapsed, /Add subtask to SEO Setup/);
    assert.doesNotMatch(collapsed, /data-add-parent="setup"/);
    assert.equal(collapsed.match(/data-plan-add="true"/g)?.length, 1);
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
