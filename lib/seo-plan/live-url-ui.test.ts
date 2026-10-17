import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'month_1',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

function render(tasks: StageListTask[]) {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks,
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        onSetLiveUrl: async () => null,
        clientName: 'Scott Cole',
    }));
}

function row(html: string, id: string): string {
    const start = html.indexOf(`data-task-id="${id}"`);
    assert.ok(start > 0, id);
    return html.slice(start, html.indexOf('data-task-id=', start + 10) === -1 ? undefined : html.indexOf('data-task-id=', start + 10));
}

test('a content row offers a live URL and other rows keep it on hover', () => {
    const html = render([
        task({ id: 'publish', title: 'Publish Approved SEO Content', category: 'content', position: 1 }),
        task({
            id: 'piece',
            title: 'Chino service page',
            category: 'content',
            parentTaskId: 'publish',
            position: 1,
            publishedUrl: 'https://example.com/chino',
            status: 'done',
        }),
        task({ id: 'robots', title: 'Review robots.txt', category: 'technical', stage: 'month_2', position: 1 }),
    ]);
    const publish = row(html, 'publish');
    assert.match(publish, /Add live URL/);
    assert.doesNotMatch(publish, /class="[^"]*\bh-0\b/);
    const piece = row(html, 'piece');
    assert.ok(piece.includes('href="https://example.com/chino"'));
    assert.ok(piece.includes('>example.com/chino<'));
    assert.equal(piece.includes('>https://example.com/chino<'), false);
    const robots = row(html, 'robots');
    assert.match(robots, /Add live URL/);
    assert.match(robots, /class="[^"]*\bh-0\b/);
});
