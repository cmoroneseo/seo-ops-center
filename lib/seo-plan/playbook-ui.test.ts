import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { PlaybookAddCall, PlaybookExisting, PlaybookOrgTask } from './playbook.ts';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLButtonElement: globalThis.HTMLButtonElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    navigator: globalThis.navigator,
    act: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT,
};
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const elementPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
elementPrototype.attachEvent ??= () => undefined;
elementPrototype.detachEvent ??= () => undefined;

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title' | 'stage'>): StageListTask {
    return {
        status: 'todo',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

function typeInto(node: HTMLInputElement, text: string) {
    node.focus();
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(node, text);
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    node.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    node.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
}

function box(title: string): HTMLInputElement {
    const found = [...document.querySelectorAll('[data-playbook-title]')].find(node => node.getAttribute('data-playbook-title') === title);
    assert.ok(found instanceof dom.window.HTMLInputElement, title);
    return found;
}

function mount(options: {
    board?: 'phases' | 'months';
    tasks?: StageListTask[];
    planRows?: PlaybookExisting[];
    orgTasks?: PlaybookOrgTask[];
    orgTasksReady?: boolean;
    onAdd?: (input: PlaybookAddCall) => Promise<void>;
} = {}) {
    const calls: PlaybookAddCall[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const props = {
        tasks: options.tasks ?? [
            task({ id: 'kickoff', title: 'Hold kickoff call and set expectations', stage: 'foundation' }),
        ],
        board: options.board ?? 'phases' as const,
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: options.onAdd ?? (async (input: PlaybookAddCall) => { calls.push(input); }),
        onReorder: async () => undefined,
        today: '2026-10-19',
        initialMonth: '2026-10',
        planRows: options.planRows,
        orgTasks: options.orgTasks,
        orgTasksReady: options.orgTasksReady,
    };
    act(() => { root.render(createElement(StagePlanListView, props)); });
    return {
        calls,
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

test.after(() => {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.HTMLInputElement = previous.HTMLInputElement;
    globalThis.HTMLButtonElement = previous.HTMLButtonElement;
    globalThis.Element = previous.Element;
    globalThis.Node = previous.Node;
    Object.defineProperty(globalThis, 'navigator', { value: previous.navigator, configurable: true });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous.act;
});

test('search filters the drawer and a task already on the plan cannot be picked', async () => {
    const view = mount({
        planRows: [{ title: 'Confirm website and CMS access', templateKey: 'access.cms' }],
        orgTasks: [{ id: 'tpl-1', title: 'Send the monthly report', description: 'Mail the report.' }],
    });
    try {
        const open = document.querySelector('[data-playbook-open="growth"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        const growth = document.querySelector('[data-playbook-stage="growth"]');
        assert.ok(growth instanceof dom.window.HTMLInputElement);
        assert.equal(growth.checked, true);
        assert.equal(document.querySelector('[data-playbook-stage="foundation"]') instanceof dom.window.HTMLInputElement, true);

        const search = document.querySelector('[data-playbook-search]');
        assert.ok(search instanceof dom.window.HTMLInputElement);
        await act(async () => { typeInto(search, 'kickoff'); });
        assert.equal(box('Hold kickoff call and set expectations').disabled, true);
        assert.equal(box('Hold kickoff call and set expectations').getAttribute('data-playbook-state'), 'plan');
        assert.equal(box('Hold the kickoff and confirm the agreement').getAttribute('data-playbook-state'), 'plan');
        assert.equal(document.body.textContent?.includes('Review robots.txt and XML sitemap'), false);
        assert.match(document.body.textContent ?? '', /Already in the plan/);

        await act(async () => { typeInto(search, 'website'); });
        assert.equal(box('Confirm website and CMS access').getAttribute('data-playbook-state'), 'plan');
        assert.equal(document.querySelectorAll('[data-playbook-title="Confirm website and CMS access"]').length, 2);

        await act(async () => { typeInto(search, 'monthly report'); });
        assert.equal(box('Send the monthly report').getAttribute('data-playbook-state'), 'open');
        assert.equal(document.querySelector('[data-playbook-section="saved"]') instanceof Element, true);
        assert.equal(document.querySelector('[data-playbook-section="library"]'), null);
    } finally {
        view.unmount();
    }
});

test('multi-select adds the chosen tasks into the stage the person picks', async () => {
    const view = mount();
    try {
        const open = document.querySelector('[data-playbook-open="foundation"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        const search = document.querySelector('[data-playbook-search]');
        assert.ok(search instanceof dom.window.HTMLInputElement);

        await act(async () => { typeInto(search, 'xml sitemap'); });
        await act(async () => { box('Review robots.txt and XML sitemap').click(); });
        await act(async () => { typeInto(search, 'local landing'); });
        await act(async () => { box('Build local landing pages').click(); });

        const scale = document.querySelector('[data-playbook-stage="scale"]');
        assert.ok(scale instanceof dom.window.HTMLInputElement);
        await act(async () => { scale.click(); });
        const add = document.querySelector('[data-playbook-add]');
        assert.ok(add instanceof dom.window.HTMLButtonElement);
        assert.match(add.textContent ?? '', /Add 2 tasks/);
        await act(async () => { add.click(); });

        assert.equal(view.calls.length, 1);
        assert.equal(view.calls[0]?.stage, 'scale');
        assert.deepEqual(view.calls[0]?.titles, [
            'Review robots.txt and XML sitemap',
            'Build local landing pages',
        ]);
        assert.equal(view.calls[0]?.dueDate, undefined);
        assert.equal(Object.hasOwn(view.calls[0] ?? {}, 'organizationId'), false);
        assert.equal(Object.hasOwn(view.calls[0] ?? {}, 'clientId'), false);
        assert.equal(document.querySelector('[data-playbook-drawer]'), null);
    } finally {
        view.unmount();
    }
});

test('select all skips tasks already on the plan and a failed add stays in the drawer', async () => {
    let failed = false;
    const view = mount({
        onAdd: async () => {
            failed = true;
            throw new Error('add failed');
        },
    });
    try {
        const open = document.querySelector('[data-playbook-open="plan"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        assert.equal((document.querySelector('[data-playbook-stage="foundation"]') as HTMLInputElement | null)?.checked, true);

        const search = document.querySelector('[data-playbook-search]');
        assert.ok(search instanceof dom.window.HTMLInputElement);
        await act(async () => { typeInto(search, 'kickoff'); });
        const select = document.querySelector('[data-playbook-select="section:checklist"]');
        assert.ok(select instanceof dom.window.HTMLButtonElement);
        await act(async () => { select.click(); });
        assert.equal(box('Hold kickoff call and set expectations').checked, false);
        assert.equal(box('Hold the kickoff and confirm the agreement').checked, false);

        await act(async () => { typeInto(search, 'xml sitemap'); });
        const librarySelect = document.querySelector('[data-playbook-select="group:technical"]');
        assert.ok(librarySelect instanceof dom.window.HTMLButtonElement);
        await act(async () => { librarySelect.click(); });
        assert.equal(box('Review robots.txt and XML sitemap').checked, true);

        const add = document.querySelector('[data-playbook-add]');
        assert.ok(add instanceof dom.window.HTMLButtonElement);
        await act(async () => { add.click(); });
        assert.equal(failed, true);
        assert.equal(document.querySelector('[data-playbook-drawer]') instanceof Element, true);
        assert.match(document.body.textContent ?? '', /Could not add those tasks/);
    } finally {
        view.unmount();
    }
});

test('the month board adds into Onboarding, This month, or Backlog', async () => {
    const view = mount({
        board: 'months',
        tasks: [
            task({ id: 'kickoff', title: 'Kickoff call', stage: 'onboarding' }),
            task({ id: 'later', title: 'Later cleanup', stage: 'backlog' }),
        ],
    });
    try {
        const open = document.querySelector('[data-playbook-open="backlog"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        const backlog = document.querySelector('[data-playbook-stage="backlog"]');
        assert.ok(backlog instanceof dom.window.HTMLInputElement);
        assert.equal(backlog.checked, true);
        assert.equal(document.querySelector('[data-playbook-stage="foundation"]'), null);
        assert.match(document.querySelector('[data-playbook-stage-detail]')?.textContent ?? '', /no date yet/);

        const month = document.querySelector('[data-playbook-stage="this_month"]');
        assert.ok(month instanceof dom.window.HTMLInputElement);
        await act(async () => { month.click(); });
        assert.match(document.querySelector('[data-playbook-stage-detail]')?.textContent ?? '', /end of this month/);

        const search = document.querySelector('[data-playbook-search]');
        assert.ok(search instanceof dom.window.HTMLInputElement);
        await act(async () => { typeInto(search, 'xml sitemap'); });
        await act(async () => { box('Review robots.txt and XML sitemap').click(); });
        const add = document.querySelector('[data-playbook-add]');
        assert.ok(add instanceof dom.window.HTMLButtonElement);
        await act(async () => { add.click(); });
        assert.equal(view.calls.length, 1);
        assert.equal(view.calls[0]?.stage, 'backlog');
        assert.equal(view.calls[0]?.dueDate, '2026-10-31');
        assert.deepEqual(view.calls[0]?.items, [{ title: 'Review robots.txt and XML sitemap', depth: 0 }]);
        assert.equal(Object.hasOwn(view.calls[0] ?? {}, 'clientId'), false);
    } finally {
        view.unmount();
    }
});

test('saved organization tasks stay hidden until they load', async () => {
    const view = mount({ orgTasksReady: false, orgTasks: [] });
    try {
        const open = document.querySelector('[data-playbook-open="plan"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        assert.match(document.body.textContent ?? '', /Loading your saved tasks/);
        assert.equal(document.querySelector('[data-playbook-section="saved"]'), null);
        assert.equal(document.querySelector('[data-playbook-section="checklist"]') instanceof Element, true);
        await act(async () => {
            const search = document.querySelector('[data-playbook-search]');
            assert.ok(search instanceof dom.window.HTMLInputElement);
            typeInto(search, 'no-such-task-xyz');
        });
        assert.match(document.body.textContent ?? '', /No saved tasks match that search/);
    } finally {
        view.unmount();
    }
});
