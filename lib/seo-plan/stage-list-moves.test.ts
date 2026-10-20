import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { StageListTask } from './stage-list.ts';
import { useStageListMoves } from './stage-list-moves.ts';
import { stageMoveBy, type StageMoveDirection, type StageReorderMove } from './stage-reorder.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    act: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT,
};
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'onboarding',
        position: null,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const column: StageListTask[] = [
    task({ id: 'alpha', title: 'Alpha', position: 1 }),
    task({ id: 'bravo', title: 'Bravo', position: 2 }),
    task({ id: 'charlie', title: 'Charlie', position: 3 }),
];

function Harness({
    initial,
    persist,
}: {
    initial: StageListTask[];
    persist: (move: StageReorderMove) => Promise<StageListTask[]>;
}) {
    const list = useStageListMoves(persist, initial);
    const click = (id: string, direction: StageMoveDirection) => {
        const move = stageMoveBy(list.tasks ?? [], id, direction);
        if (move) void list.move(move);
    };
    const buttons: [string, string, StageMoveDirection][] = [
        ['Move Alpha down', 'alpha', 'down'],
        ['Move Alpha to Backlog', 'alpha', 'next-stage'],
        ['Move Add keywords out of SEO Setup', 'keywords', 'unnest'],
        ['Move Add keywords to Backlog', 'keywords', 'next-stage'],
    ];
    return createElement(
        'div',
        null,
        buttons.map(([label, id, direction]) => createElement('button', {
            key: label,
            type: 'button',
            'aria-label': label,
            onClick: () => click(id, direction),
        }, label)),
        createElement(StagePlanListView, {
            tasks: list.tasks ?? [],
            query: '',
            onQueryChange: () => undefined,
            onOpenTask: () => undefined,
            onAddTasks: async () => undefined,
            onReorder: list.move,
            clientName: 'Acme',
            today: '2026-10-19',
            initialMonth: '2026-10',
        }),
    );
}

function button(label: string): HTMLButtonElement {
    const found = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label);
    assert.ok(found instanceof dom.window.HTMLButtonElement, label);
    return found;
}

function order(stage = 'onboarding'): string[] {
    return [...document.querySelectorAll(`[data-stage="${stage}"] [data-task-id]`)].map(node => node.getAttribute('data-task-id') ?? '');
}

async function mount(initial: StageListTask[], persist: (move: StageReorderMove) => Promise<StageListTask[]>): Promise<Root> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(createElement(Harness, { initial, persist }));
    });
    return root;
}

test.after(() => {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.Element = previous.Element;
    globalThis.Node = previous.Node;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous.act;
});

test('move buttons keep saving after the first click', async () => {
    const calls: StageReorderMove[] = [];
    const root = await mount(column, async move => {
        calls.push({ ...move });
        return [];
    });
    try {
        await act(async () => { button('Move Alpha down').click(); });
        assert.deepEqual(calls.map(call => call.index), [1]);
        assert.equal(calls[0].taskId, 'alpha');
        assert.equal(calls[0].stage, 'onboarding');
        assert.equal(calls[0].parentTaskId, null);
        assert.deepEqual(order(), ['bravo', 'alpha', 'charlie']);

        await act(async () => { button('Move Alpha down').click(); });
        assert.deepEqual(calls.map(call => call.index), [1, 2]);
        assert.deepEqual(order(), ['bravo', 'charlie', 'alpha']);

        await act(async () => { button('Move Alpha to Backlog').click(); });
        assert.equal(calls.length, 3);
        assert.equal(calls[2].stage, 'backlog');
        assert.equal(calls[2].parentTaskId, null);
        assert.deepEqual(order('backlog'), ['alpha']);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('a second button move still saves while the first request is in flight', async () => {
    const calls: StageReorderMove[] = [];
    let releaseFirst: (rows: StageListTask[]) => void = () => undefined;
    const firstGate = new Promise<StageListTask[]>(resolve => { releaseFirst = resolve; });
    const root = await mount(column, async move => {
        calls.push({ ...move });
        if (calls.length === 1) return firstGate;
        return [];
    });
    try {
        await act(async () => { button('Move Alpha down').click(); });
        assert.equal(calls.length, 1);

        await act(async () => { button('Move Alpha down').click(); });
        assert.equal(calls.length, 1);
        assert.deepEqual(order(), ['bravo', 'charlie', 'alpha']);

        await act(async () => {
            releaseFirst([
                task({ id: 'bravo', title: 'Bravo', position: 1 }),
                task({ id: 'alpha', title: 'Alpha', position: 2 }),
                task({ id: 'charlie', title: 'Charlie', position: 3 }),
            ]);
            await firstGate;
        });
        assert.deepEqual(calls.map(call => call.index), [1, 2]);
        assert.deepEqual(order(), ['bravo', 'charlie', 'alpha']);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('moving a subtask out of its pillar uses the same save', async () => {
    const calls: StageReorderMove[] = [];
    const root = await mount([
        task({ id: 'setup', title: 'SEO Setup', position: 1 }),
        task({ id: 'keywords', title: 'Add keywords', position: 1, parentTaskId: 'setup' }),
    ], async move => {
        calls.push({ ...move });
        return [];
    });
    try {
        await act(async () => { button('Move Add keywords out of SEO Setup').click(); });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].taskId, 'keywords');
        assert.equal(calls[0].parentTaskId, null);
        assert.equal(calls[0].stage, 'onboarding');

        await act(async () => { button('Move Add keywords to Backlog').click(); });
        assert.equal(calls.length, 2);
        assert.equal(calls[1].stage, 'backlog');
        assert.equal(calls[1].parentTaskId, null);
        assert.deepEqual(order('backlog'), ['keywords']);
    } finally {
        await act(async () => { root.unmount(); });
    }
});
