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
    task({ id: 'setup', title: 'SEO Setup', position: 1 }),
    task({
        id: 'keywords',
        title: 'Add keywords to Position tracking',

        position: 1,
        parentTaskId: 'setup',
    }),
    task({ id: 'robots', title: 'Review robots.txt', position: 1 }),
    task({ id: 'pending:draft', title: 'Saving this title', position: 2 }),
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

test('a collapsed pillar does not grow an add field', () => {
    const collapsed = render('seo setup');
    assert.match(collapsed, /aria-expanded="false"/);
    assert.doesNotMatch(collapsed, /Add subtask to SEO Setup/);
    assert.doesNotMatch(collapsed, /data-add-parent="setup"/);
    assert.equal(collapsed.match(/data-add="no-project"/g)?.length, 1);
});

test('a pending row is visible and cannot be opened', () => {
    const html = render();
    assert.match(html, /data-pending="true"[^>]*data-task-id="pending:draft"|data-task-id="pending:draft"[^>]*data-pending="true"/);
    const start = html.indexOf('data-task-id="pending:draft"');
    const row = html.slice(start, start + 2500);
    assert.match(row, /aria-label="Mark &quot;Saving this title&quot; done"[^>]*disabled=""/);
    assert.match(row, /data-plan-open="title"[^>]*disabled=""/);
    assert.match(row, /Saving this title/);
});

test('the add bar renders a labeled field and no template control', () => {
    const html = renderToStaticMarkup(createElement(StageAddBar, {
        label: 'Add a task to No project',
        placeholder: 'Add a task…',
        groupId: 'no-project',

        onAdd: async () => undefined,
    }));
    assert.match(html, /aria-label="Add a task to No project"/);
    assert.match(html, /data-add="no-project"/);
    assert.match(html, /placeholder="Add a task…"/);
    assert.doesNotMatch(html, /data-add-parent|Template library|type="submit"/);
});
