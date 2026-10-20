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
    task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', position: 1 }),
    task({
        id: 'keywords',
        title: 'Add keywords',
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
        today: '2026-10-19',
        initialMonth: '2026-10',
    }));
}

function openingTag(html: string, taskId: string): string {
    const at = html.indexOf(`data-task-id="${taskId}"`);
    assert.ok(at > 0, taskId);
    return html.slice(html.lastIndexOf('<div', at), html.indexOf('>', at) + 1);
}

test('a pillar row drags from the card and a subtask drags from its grip', () => {
    const html = render();
    const setup = openingTag(html, 'setup');
    assert.match(setup, /data-stage-drag="task"/);
    assert.match(setup, /draggable="true"/);
    assert.doesNotMatch(html, /aria-label="Move SEO Setup|data-stage-move=/);

    const subtask = openingTag(html, 'keywords');
    assert.match(subtask, /data-stage-role="subtask"/);
    assert.doesNotMatch(subtask, /draggable/);
    assert.match(html, /data-stage-grip="keywords"/);
    assert.match(html, /title="Drag Add keywords"/);
    assert.doesNotMatch(html, /Move Add keywords/);

    assert.doesNotMatch(html, /data-stage-drop="month_|Move SEO Setup to Month/);
    assert.match(html, /data-stage-drop="onboarding"/);
    assert.match(html, /data-stage-drop="this_month"/);
    assert.match(html, /data-stage-drop="backlog"/);
});

test('search and a pending row do not offer a drag', () => {
    const searching = render('keywords');
    assert.doesNotMatch(searching, /draggable|data-stage-grip|data-stage-move|data-stage-drop/);
    assert.match(searching, /<mark[^>]*>keywords<\/mark>/);

    const html = render();
    const pending = openingTag(html, 'pending:draft');
    assert.doesNotMatch(pending, /draggable|data-stage-drag/);
    assert.doesNotMatch(html, /Move Saving this title/);
});
