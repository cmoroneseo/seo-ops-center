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
        stage: 'backlog',
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
        today: '2026-10-19',
        initialMonth: '2026-10',
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
            completedAt: '2026-10-12T18:00:00.000Z',
        }),
        task({ id: 'robots', title: 'Review robots.txt', category: 'technical', stage: 'onboarding', position: 1 }),
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
    assert.equal(html.includes('Not indexed yet'), false);
    assert.equal(html.includes('data-live-result'), false);
});

test('a done subtask shows its result and the pillar adds the subtasks', () => {
    const html = renderToStaticMarkup(createElement(StagePlanListView, {
        tasks: [
            task({ id: 'publish', title: 'Publish Approved SEO Content', category: 'content', position: 1 }),
            task({
                id: 'piece',
                title: 'Chino service page',
                category: 'content',
                parentTaskId: 'publish',
                position: 1,
                publishedUrl: 'https://example.com/chino',
                status: 'done',
                completedAt: '2026-10-12T18:00:00.000Z',
            }),
            task({
                id: 'eastvale',
                title: 'Eastvale service page',
                category: 'content',
                parentTaskId: 'publish',
                position: 2,
                publishedUrl: 'https://example.com/eastvale',
                status: 'done',
                completedAt: '2026-10-13T18:00:00.000Z',
            }),
            task({
                id: 'solo',
                title: 'Ontario page',
                category: 'content',
                stage: 'backlog',
                position: 1,
                status: 'done',
                publishedUrl: 'https://example.com/ontario',
                completedAt: '2026-10-14T18:00:00.000Z',
            }),
        ],
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        onSetLiveUrl: async () => null,
        clientName: 'Scott Cole',
        today: '2026-10-19',
        initialMonth: '2026-10',
        resultsByTaskId: {
            piece: {
                kind: 'measured',
                clicks: 4,
                impressions: 30,
                position: 3.7,
                queries: [{ query: 'chino plumber', clicks: 3, impressions: 12 }],
                comparison: null,
            },
            eastvale: { kind: 'not_indexed' },
            solo: { kind: 'not_indexed' },
        },
    }));
    const publish = row(html, 'publish');
    assert.match(publish, /4 clicks · 30 impr · pos 3\.7 · chino plumber/);
    assert.doesNotMatch(publish, /Not indexed yet/);
    const piece = row(html, 'piece');
    assert.match(piece, /4 clicks · 30 impr · pos 3\.7 · chino plumber/);
    const eastvale = row(html, 'eastvale');
    assert.match(eastvale, /Not indexed yet/);
    assert.doesNotMatch(eastvale, /0 clicks/);
    const solo = row(html, 'solo');
    assert.match(solo, /Not indexed yet/);
});
