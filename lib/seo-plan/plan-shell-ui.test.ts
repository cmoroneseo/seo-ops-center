import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { PlanSidePanel } from '../../components/seo-plan/PlanSidePanel.tsx';
import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import { planPanelTask, type PlanPanelSave } from './plan-panel.ts';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/workspace/client?tab=campaign', pretendToBeVisual: true });
const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    act: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT,
};
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
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

const rows: StageListTask[] = [
    task({ id: 'later', title: 'Later backlog', stage: 'backlog', position: 1 }),
    task({
        id: 'checklist:cal',
        title: 'Build the editorial calendar',
        stage: 'backlog',
        position: null,
        dueDate: '2026-10-29',
        description: '',
        estimatedHours: null,
    }),
];

function viewProps(panel: React.ReactNode, panelTaskId: string | null) {
    return {
        tasks: rows,
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        today: '2026-10-20',
        initialMonth: '2026-10',
        panel,
        panelTaskId,
    };
}

function ShellHarness({ open }: { open: boolean }) {
    const [panel, setPanel] = useState(open);
    return createElement('div', null,
        createElement('button', { type: 'button', 'data-test-open': 'panel', onClick: () => setPanel(true) }, 'Open'),
        createElement(StagePlanListView, viewProps(
            panel ? createElement('aside', { 'data-plan-panel': 'true' }, 'Details') : null,
            panel ? 'later' : null,
        )),
    );
}

async function mount(node: React.ReactElement): Promise<Root> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(node); });
    return root;
}

function setValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    input.focus();
    const prototype = input instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
        : input instanceof dom.window.HTMLSelectElement
            ? dom.window.HTMLSelectElement.prototype
            : dom.window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
}

test.after(() => {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.HTMLInputElement = previous.HTMLInputElement;
    globalThis.HTMLTextAreaElement = previous.HTMLTextAreaElement;
    globalThis.HTMLSelectElement = previous.HTMLSelectElement;
    globalThis.HTMLButtonElement = previous.HTMLButtonElement;
    globalThis.Element = previous.Element;
    globalThis.Node = previous.Node;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous.act;
});

test('overviewMonth opens that month and the arrows write it back', async () => {
    window.history.replaceState(null, '', '/workspace/client?tab=campaign&overviewTask=later&overviewMonth=2026-11');
    const root = await mount(createElement(StagePlanListView, viewProps(null, null)));
    try {
        assert.equal(document.querySelector('[data-plan-month]')?.getAttribute('data-plan-month'), '2026-11');
        assert.match(window.location.search, /overviewMonth=2026-11/);
        assert.match(window.location.search, /overviewTask=later/);
        const next = document.querySelector('[aria-label="Next month"]');
        assert.ok(next instanceof dom.window.HTMLButtonElement);
        await act(async () => { next.click(); });
        assert.equal(document.querySelector('[data-plan-month]')?.getAttribute('data-plan-month'), '2026-12');
        assert.match(window.location.search, /overviewMonth=2026-12/);
        assert.match(window.location.search, /tab=campaign/);
        assert.match(window.location.search, /overviewTask=later/);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('an expanded backlog stays expanded when the panel opens', async () => {
    window.history.replaceState(null, '', '/workspace/client?tab=campaign');
    const root = await mount(createElement(ShellHarness, { open: false }));
    try {
        const backlog = document.querySelector('[data-plan-section="backlog"]');
        assert.equal(backlog?.getAttribute('data-plan-collapsed'), 'true');
        const toggle = backlog?.querySelector('button');
        assert.ok(toggle instanceof dom.window.HTMLButtonElement);
        await act(async () => { toggle.click(); });
        assert.equal(document.querySelector('[data-plan-section="backlog"]')?.getAttribute('data-plan-collapsed'), 'false');
        assert.equal(document.querySelector('[data-plan-shell]')?.getAttribute('data-plan-shell'), 'closed');
        const open = document.querySelector('[data-test-open="panel"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        assert.equal(document.querySelector('[data-plan-shell]')?.getAttribute('data-plan-shell'), 'open');
        assert.equal(document.querySelector('[data-plan-section="backlog"]')?.getAttribute('data-plan-collapsed'), 'false');
        assert.ok(document.querySelector('[data-plan-panel]'));
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('a dated checklist row is in the month list and is not an editable task', async () => {
    window.history.replaceState(null, '', '/workspace/client?tab=campaign&overviewMonth=2026-10');
    const root = await mount(createElement(StagePlanListView, viewProps(null, null)));
    try {
        const row = document.querySelector('[data-plan-row="checklist:cal"]');
        assert.ok(row);
        assert.equal(row.closest('[data-plan-section]')?.getAttribute('data-plan-section'), 'this_month');
        assert.equal(row.querySelector('[data-plan-checklist]')?.textContent, 'Checklist');
        const title = row.querySelector('[data-plan-open="title"]');
        assert.ok(title instanceof dom.window.HTMLButtonElement);
        assert.equal(title.disabled, true);
        const check = row.querySelector('[data-plan-check]');
        assert.ok(check instanceof dom.window.HTMLButtonElement);
        assert.equal(check.disabled, true);
        assert.equal(row.getAttribute('draggable'), null);
    } finally {
        await act(async () => { root.unmount(); });
    }
});

test('the known description is editable immediately, and a failed save shows a toast with retry', async () => {
    const source = task({
        id: 'r30',
        title: 'November pages',
        status: 'in_progress',
        description: 'Known from the list',
        estimatedHours: 1,
    });
    const model = planPanelTask({ task: source, tasks: [source] });
    const saves: PlanPanelSave[] = [];
    let fail = true;
    let closed = 0;
    const root = await mount(createElement(PlanSidePanel, {
        task: model,
        tasks: [source],
        people: [],
        clientName: 'Sandbox Client A',
        today: '2026-10-21',
        now: new Date('2026-10-21T19:00:00.000Z'),
        focusField: null,
        onSave: async (_id: string, save: PlanPanelSave) => {
            saves.push(save);
            return fail ? 'Could not save that change.' : null;
        },
        onDuplicate: async () => null,
        onDelete: async () => null,
        onClose: () => { closed += 1; },
    }));
    try {
        const description = document.querySelector('[data-plan-field="description"]');
        assert.ok(description instanceof dom.window.HTMLTextAreaElement);
        assert.equal(description.disabled, false);
        assert.equal(description.value, 'Known from the list');
        assert.equal(document.body.textContent?.includes('Loading description'), false);
        assert.equal(document.querySelector('[data-plan-save-toast]'), null);

        const status = document.querySelector('[data-plan-field="status"]');
        assert.ok(status instanceof dom.window.HTMLSelectElement);
        await act(async () => { setValue(status, 'done'); });
        const toast = document.querySelector('[data-plan-save-toast]');
        assert.equal(toast?.getAttribute('role'), 'alert');
        assert.match(toast?.textContent ?? '', /Could not save that change/);
        assert.equal(document.querySelector('[data-plan-save]')?.getAttribute('data-plan-save'), 'error');
        assert.equal(document.body.textContent?.includes('Saved'), false);

        fail = false;
        const retry = [...(toast?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Retry');
        assert.ok(retry instanceof dom.window.HTMLButtonElement);
        await act(async () => { retry.click(); });
        assert.equal(document.querySelector('[data-plan-save-toast]'), null);
        assert.equal(document.querySelector('[data-plan-save]')?.textContent, 'Saved');
        assert.deepEqual(saves.at(-1), { field: 'status', status: 'done' });

        const estimate = document.querySelector('[data-plan-field="estimate"]');
        assert.ok(estimate instanceof dom.window.HTMLInputElement);
        assert.equal(estimate.disabled, false);
        await act(async () => { setValue(estimate, '3'); });
        assert.equal(estimate.value, '3');
        const close = document.querySelector('[aria-label="Close"]');
        assert.ok(close instanceof dom.window.HTMLButtonElement);
        await act(async () => { close.click(); });
        assert.equal(closed, 1);
        assert.deepEqual(saves.at(-1), { field: 'estimate', estimatedHours: 3 });
    } finally {
        await act(async () => { root.unmount(); });
    }
});
