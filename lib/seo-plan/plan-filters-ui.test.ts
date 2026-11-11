import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { StageReorderMove } from './stage-reorder.ts';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/workspace/harbor?tab=campaign', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
const elementPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
elementPrototype.attachEvent ??= () => undefined;
elementPrototype.detachEvent ??= () => undefined;

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RANK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title' | 'stage'>): StageListTask {
    return {
        status: 'todo',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        priority: 'medium',
        assigneeIds: [],
        initiativeId: null,
        ...overrides,
    };
}

const seed: StageListTask[] = [
    task({
        id: 'page',
        title: 'Rewrite the service page',
        stage: 'foundation',
        status: 'todo',
        priority: 'high',
        assigneeIds: [ME],
        initiativeId: RANK,
    }),
    task({
        id: 'heading',
        title: 'Check one heading',
        stage: 'foundation',
        status: 'in_progress',
        priority: 'low',
        parentTaskId: 'page',
        assigneeIds: [OTHER],
        position: 1,
    }),
    task({
        id: 'footer',
        title: 'Fix the footer',
        stage: 'growth',
        status: 'in_progress',
        priority: 'high',
        assigneeIds: [ME],
        position: 1,
    }),
    task({
        id: 'later',
        title: 'Plan the next city page',
        stage: 'backlog',
        status: 'done',
        priority: 'medium',
        assigneeIds: [],
        position: 1,
    }),
];

function rowIds(): string[] {
    return [...document.querySelectorAll('[data-plan-row]')].map(node => node.getAttribute('data-plan-row') ?? '').sort();
}

function setControl(selector: string, value: string) {
    const control = document.querySelector(selector);
    assert.ok(control instanceof dom.window.HTMLSelectElement || control instanceof dom.window.HTMLInputElement, selector);
    control.focus();
    const prototype = control instanceof dom.window.HTMLSelectElement
        ? dom.window.HTMLSelectElement.prototype
        : dom.window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(control, value);
    control.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    control.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    control.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
}

function dragEvent(type: string): Event {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
        value: {
            effectAllowed: 'move',
            setData() {},
            getData: () => '',
        },
    });
    return event;
}

function Board({
    tasks,
    query = '',
    onQuery,
}: {
    tasks: StageListTask[];
    query?: string;
    onQuery?: (query: string) => void;
}) {
    const [text, setText] = useState(query);
    const [rows, setRows] = useState(tasks);
    return createElement(StagePlanListView, {
        tasks: rows,
        board: 'phases',
        query: text,
        onQueryChange: (next: string) => {
            setText(next);
            onQuery?.(next);
        },
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async (move: StageReorderMove) => {
            setRows(current => current.map(item => (
                item.id === move.taskId ? { ...item, stage: move.stage } : item
            )));
        },
        today: '2026-11-07',
        people: [
            { id: ME, name: 'Carlos Morones', initials: 'CM' },
            { id: OTHER, name: 'Abel Miranda', initials: 'AM' },
        ],
        viewerId: ME,
        partOfReady: true,
        partOfChoices: [{ id: RANK, title: 'Rank the service pages' }],
    });
}

async function mount(node: React.ReactElement): Promise<Root> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(node); });
    return root;
}

test('filters combine, quick views and Clear reset them, and the address keeps the view', async () => {
    window.history.replaceState(null, '', '/workspace/harbor?tab=campaign&overviewMonth=2026-11');
    const root = await mount(createElement(Board, { tasks: seed }));
    try {
        assert.deepEqual(rowIds(), ['footer', 'heading', 'later', 'page']);
        await act(async () => { setControl('[data-plan-filter="status"]', 'in_progress'); });
        await act(async () => { setControl('[data-plan-filter="priority"]', 'high'); });
        assert.deepEqual(rowIds(), ['footer']);
        assert.equal(document.querySelector('[data-plan-filter-count]')?.textContent, '2 filters');
        assert.match(window.location.search, /planStatus=in_progress/);
        assert.match(window.location.search, /planPriority=high/);
        assert.match(window.location.search, /tab=campaign/);
        assert.match(window.location.search, /overviewMonth=2026-11/);

        await act(async () => { setControl('[data-plan-search]', 'footer'); });
        assert.deepEqual(rowIds(), ['footer']);
        assert.equal(document.querySelector('[data-plan-filter-count]')?.textContent, '3 filters');

        await act(async () => { setControl('[data-plan-search]', 'sitemap'); });
        assert.deepEqual(rowIds(), []);
        assert.match(document.querySelector('[data-plan-filter-empty]')?.textContent ?? '', /No tasks match these filters/);
        assert.equal(document.body.textContent?.includes('This plan has no tasks yet'), false);

        const clear = document.querySelector('[data-plan-filter-clear]');
        assert.ok(clear instanceof dom.window.HTMLButtonElement);
        await act(async () => { clear.click(); });
        assert.deepEqual(rowIds(), ['footer', 'heading', 'later', 'page']);
        assert.equal(document.querySelector('[data-plan-filter-count]'), null);
        assert.equal(new URL(window.location.href).searchParams.get('planStatus'), null);
        assert.equal(new URL(window.location.href).searchParams.get('planQ'), null);

        const mine = document.querySelector('[data-plan-view="mine"]');
        const notStarted = document.querySelector('[data-plan-view="not-started"]');
        const progress = document.querySelector('[data-plan-view="in-progress"]');
        const done = document.querySelector('[data-plan-view="done"]');
        assert.ok(mine instanceof dom.window.HTMLButtonElement);
        assert.ok(notStarted instanceof dom.window.HTMLButtonElement);
        assert.ok(progress instanceof dom.window.HTMLButtonElement);
        assert.ok(done instanceof dom.window.HTMLButtonElement);

        await act(async () => { notStarted.click(); });
        assert.equal(notStarted.getAttribute('aria-pressed'), 'true');
        assert.deepEqual(rowIds(), ['page']);
        await act(async () => { progress.click(); });
        assert.equal(progress.getAttribute('aria-pressed'), 'true');
        assert.equal(notStarted.getAttribute('aria-pressed'), 'false');
        assert.deepEqual(rowIds(), ['footer', 'heading', 'page']);
        await act(async () => { done.click(); });
        assert.deepEqual(rowIds(), ['later']);
        await act(async () => { mine.click(); });
        assert.equal(mine.getAttribute('aria-pressed'), 'true');
        assert.deepEqual(rowIds(), ['footer', 'page']);
        assert.match(window.location.search, new RegExp(`planAssignee=${ME}`));
    } finally {
        await act(async () => { root.unmount(); });
    }

    window.history.replaceState(null, '', `/workspace/harbor?tab=campaign&planStatus=todo&planPriority=high&planStage=foundation&planPart=${RANK}&planQ=service`);
    let seen = '';
    const again = await mount(createElement(Board, {
        tasks: seed,
        onQuery: value => { seen = value; },
    }));
    try {
        assert.equal(seen, 'service');
        assert.deepEqual(rowIds(), ['page']);
        assert.equal(document.querySelector('[data-plan-filter="status"]')?.getAttribute('value') ?? (document.querySelector('[data-plan-filter="status"]') as HTMLSelectElement).value, 'todo');
        assert.match(window.location.search, /planQ=service/);
        assert.match(window.location.search, /tab=campaign/);
    } finally {
        await act(async () => { again.unmount(); });
    }
});

test('dragging to another stage hides the task when that stage is filtered out, and keeps it otherwise', async () => {
    window.history.replaceState(null, '', '/workspace/harbor?tab=campaign');
    const root = await mount(createElement(Board, { tasks: seed }));
    try {
        await act(async () => { setControl('[data-plan-filter="stage"]', 'foundation'); });
        assert.deepEqual(rowIds(), ['heading', 'page']);
        const page = document.querySelector('[data-task-id="page"]');
        const growth = document.querySelector('[data-plan-section="growth"]');
        assert.equal(page?.getAttribute('data-stage-drag'), 'task');
        assert.equal(growth?.getAttribute('data-stage-drop'), 'growth');
        await act(async () => {
            page?.dispatchEvent(dragEvent('dragstart'));
            growth?.dispatchEvent(dragEvent('drop'));
        });
        assert.equal(rowIds().includes('page'), false);
        assert.match(document.querySelector('[data-plan-section="growth"]')?.textContent ?? '', /No tasks in Growth match these filters|No matching tasks/);

        await act(async () => { setControl('[data-plan-filter="stage"]', ''); });
        await act(async () => { setControl('[data-plan-filter="status"]', 'in_progress'); });
        const footer = document.querySelector('[data-task-id="footer"]');
        const scale = document.querySelector('[data-plan-section="scale"]');
        assert.equal(footer?.getAttribute('data-stage-drag'), 'task');
        await act(async () => {
            footer?.dispatchEvent(dragEvent('dragstart'));
            scale?.dispatchEvent(dragEvent('drop'));
        });
        assert.equal(document.querySelector('[data-task-id="footer"]')?.closest('[data-plan-section]')?.getAttribute('data-plan-section'), 'scale');
    } finally {
        await act(async () => { root.unmount(); });
    }
});
