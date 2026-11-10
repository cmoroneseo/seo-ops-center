import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { PlanSidePanel } from '../../components/seo-plan/PlanSidePanel.tsx';
import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import { planPanelTask, type PlanPanelSave } from './plan-panel.ts';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
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

const rank = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-10-02T15:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const plan = [
    task({ id: 'page', title: 'Rewrite the service page', initiativeId: null }),
    task({ id: 'child', title: 'Check one heading', parentTaskId: 'page', initiativeId: null }),
    task({ id: 'footer', title: 'Fix the footer', initiativeId: null, position: 2 }),
];

const goals = [{ id: rank, title: 'Rank the service pages' }];

async function mount(node: React.ReactElement): Promise<Root> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(node); });
    return root;
}

function panel(taskId: string, saves: PlanPanelSave[]) {
    const source = plan.find(item => item.id === taskId);
    if (!source) throw new Error(taskId);
    const model = planPanelTask({ task: source, tasks: plan });
    return createElement(PlanSidePanel, {
        task: model,
        tasks: plan,
        people: [],
        clientName: 'Harbor Dental',
        today: '2026-11-07',
        partOf: goals,
        focusField: null,
        onSave: async (_id, save) => {
            saves.push(save);
            return null;
        },
        onDuplicate: async () => null,
        onDelete: async () => null,
        onClose: () => undefined,
    });
}

test('a main task can be part of a roadmap row, and a nested task cannot', async () => {
    const saves: PlanPanelSave[] = [];
    const root = await mount(panel('page', saves));
    try {
        assert.equal(document.querySelector('[data-plan-part-of]')?.textContent, 'Part of: None');
        const change = document.querySelector('[data-plan-field="part-of"]');
        assert.ok(change instanceof dom.window.HTMLButtonElement);
        await act(async () => { change.click(); });
        const choice = document.querySelector(`[data-plan-part-of-choice="${rank}"]`);
        assert.ok(choice instanceof dom.window.HTMLButtonElement);
        assert.equal(choice.textContent, 'Rank the service pages');
        await act(async () => { choice.click(); });
        assert.deepEqual(saves.at(-1), { field: 'partOf', initiativeId: rank });

        const clear = document.querySelector('[data-plan-part-of-choice="none"]');
        assert.equal(clear, null);
        await act(async () => { (document.querySelector('[data-plan-field="part-of"]') as HTMLButtonElement).click(); });
        const none = document.querySelector('[data-plan-part-of-choice="none"]');
        assert.ok(none instanceof dom.window.HTMLButtonElement);
        await act(async () => { none.click(); });
        assert.deepEqual(saves.at(-1), { field: 'partOf', initiativeId: null });
    } finally {
        await act(async () => { root.unmount(); });
    }

    const childRoot = await mount(panel('child', []));
    try {
        assert.equal(document.querySelector('[data-plan-part-of]'), null);
        assert.equal(document.querySelector('[data-plan-field="part-of"]'), null);
    } finally {
        await act(async () => { childRoot.unmount(); });
    }
});

test('the plan board can show only tasks that are part of one row', async () => {
    const tasks = [
        task({ id: 'page', title: 'Rewrite the service page', initiativeId: rank }),
        task({ id: 'child', title: 'Check one heading', parentTaskId: 'page', position: 1 }),
        task({ id: 'footer', title: 'Fix the footer', initiativeId: null, position: 2 }),
    ];
    const root = await mount(createElement(StagePlanListView, {
        tasks,
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        today: '2026-11-07',
        initialMonth: '2026-11',
        partOfChoices: goals,
    }));
    try {
        const select = document.querySelector('[data-plan-part-of]');
        assert.ok(select instanceof dom.window.HTMLSelectElement);
        assert.equal(select.getAttribute('aria-label'), 'Part of');
        const ids = () => [...document.querySelectorAll('[data-plan-row]')].map(node => node.getAttribute('data-plan-row'));
        assert.deepEqual(ids().sort(), ['child', 'footer', 'page']);
        const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')?.set;
        await act(async () => {
            setter?.call(select, rank);
            select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        assert.deepEqual(ids().sort(), ['child', 'page']);
        assert.equal(document.body.textContent?.includes('initiative'), false);
        assert.equal(document.body.textContent?.includes('pillar'), false);
    } finally {
        await act(async () => { root.unmount(); });
    }
});
