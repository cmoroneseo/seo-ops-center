import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { StageListTask } from './stage-list.ts';
import type { PlanRowTimerView } from './row-timer.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
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
        stage: null,
        position: null,
        parentTaskId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        dueDate: '2026-10-22',
        ...overrides,
    };
}

const tasks: StageListTask[] = [
    task({ id: 'alpha', title: 'GBP optimization', position: 1, status: 'in_progress' }),
    task({ id: 'bravo', title: 'Houzz profile', position: 2 }),
];

function mount(props: {
    timerByTaskId?: Readonly<Record<string, PlanRowTimerView>>;
    onRowTimer?: (taskId: string) => void;
    onCheckRunning?: (taskId: string) => void;
    loggedHours?: Record<string, number>;
    rows?: StageListTask[];
}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const render = () => {
        root.render(createElement(StagePlanListView, {
            tasks: props.rows ?? tasks,
            query: '',
            onQueryChange: () => undefined,
            onOpenTask: () => undefined,
            onAddTasks: async () => undefined,
            onReorder: async () => undefined,
            today: '2026-10-20',
            initialMonth: '2026-10',
            loggedHours: props.loggedHours,
            timerByTaskId: props.timerByTaskId,
            onRowTimer: props.onRowTimer,
            onCheckRunning: props.onCheckRunning,
        }));
    };
    act(render);
    return {
        container,
        rerender: () => act(render),
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

function row(container: HTMLElement, id: string): HTMLElement {
    const found = container.querySelector(`[data-task-id="${id}"]`);
    assert.ok(found instanceof HTMLElement, id);
    return found;
}

test('a running row shows the pink clock and a paused row shows the pause mark', () => {
    const view = mount({
        loggedHours: { alpha: 1.5, bravo: 0.75 },
        timerByTaskId: {
            alpha: { phase: 'running', seconds: 125 },
            bravo: { phase: 'paused', seconds: 487 },
        },
        onRowTimer: () => undefined,
        onCheckRunning: () => undefined,
    });
    const running = row(view.container, 'alpha');
    const paused = row(view.container, 'bravo');
    assert.equal(running.getAttribute('data-plan-timer'), 'running');
    assert.match(running.className, /#ec4899/);
    assert.equal(running.querySelector('[data-plan-time]')?.getAttribute('data-plan-time'), '2:05');
    assert.equal(running.querySelector('[data-plan-time]')?.textContent, '2:05');
    assert.doesNotMatch(running.textContent ?? '', /1\.5h/);
    assert.equal(paused.querySelector('[data-plan-time]')?.getAttribute('data-plan-time'), '❙❙ 8:07');
    assert.doesNotMatch(paused.textContent ?? '', /45m|0\.75h/);
    assert.equal(running.querySelector('[data-plan-check-action]')?.getAttribute('data-plan-check-action'), 'stop-timer');
    assert.equal(paused.querySelector('[data-plan-check-action]'), null);
    view.unmount();
});

test('checking the running row asks for stop review, and the time control does not', () => {
    const checks: string[] = [];
    const timers: string[] = [];
    const view = mount({
        timerByTaskId: { alpha: { phase: 'running', seconds: 12 } },
        onRowTimer: taskId => { timers.push(taskId); },
        onCheckRunning: taskId => { checks.push(taskId); },
    });
    const running = row(view.container, 'alpha');
    act(() => {
        running.querySelector<HTMLButtonElement>('[data-plan-check-action="stop-timer"]')?.click();
        running.querySelector<HTMLButtonElement>('[data-plan-time]')?.click();
    });
    assert.deepEqual(checks, ['alpha']);
    assert.deepEqual(timers, ['alpha']);
    view.unmount();
});

test('starting a second row is the time control, and a promoted status shows on the row', () => {
    const timers: string[] = [];
    let rows = tasks;
    const view = mount({
        rows,
        timerByTaskId: { alpha: { phase: 'running', seconds: 30 } },
        onRowTimer: taskId => {
            timers.push(taskId);
            rows = rows.map(item => item.id === taskId && item.status === 'todo'
                ? { ...item, status: 'in_progress' }
                : item);
        },
        onCheckRunning: () => undefined,
    });
    act(() => {
        row(view.container, 'bravo').querySelector<HTMLButtonElement>('[data-plan-time]')?.click();
    });
    assert.deepEqual(timers, ['bravo']);
    view.unmount();

    const next = mount({
        rows,
        timerByTaskId: {
            alpha: { phase: 'paused', seconds: 30 },
            bravo: { phase: 'running', seconds: 1 },
        },
        onRowTimer: () => undefined,
    });
    assert.equal(row(next.container, 'bravo').getAttribute('data-plan-status'), 'in_progress');
    assert.equal(row(next.container, 'bravo').getAttribute('data-plan-timer'), 'running');
    assert.equal(row(next.container, 'alpha').getAttribute('data-plan-timer'), 'paused');
    next.unmount();
});

test('t toggles the focused row timer once per press', () => {
    const timers: string[] = [];
    const view = mount({
        onRowTimer: taskId => { timers.push(taskId); },
    });
    const press = (key: string) => {
        act(() => {
            window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
        });
    };
    press('t');
    assert.deepEqual(timers, []);
    press('j');
    press('t');
    assert.deepEqual(timers, ['alpha']);
    press('t');
    assert.deepEqual(timers, ['alpha', 'alpha']);
    view.unmount();
});
