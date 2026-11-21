import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { PlaybookAddCall, PlaybookExisting, PlaybookOrgTask } from './playbook.ts';
import type { StageListTask } from './stage-list.ts';
import { STAGE_ADD_MAX_TITLES } from './stage-add-lines.ts';

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

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
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
        partOfChoices: [{ id: 'site', title: 'Improve the website' }, { id: 'local', title: 'Local visibility' }],
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

test('each group add row submits its project without a stage', async () => {
    {
        const view = mount({});
        try {
            for (const [group, title] of [['site', 'Review index coverage'], ['no-project', 'Check analytics']]) {
                const input = document.querySelector(`[data-plan-section="${group}"] input`);
                assert.ok(input instanceof dom.window.HTMLInputElement);
                await act(async () => { typeInto(input, title); });
                await act(async () => {
                    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                });
            }
            assert.deepEqual(view.calls.map(({ initiativeId, titles }) => ({ initiativeId, titles })), [
                { initiativeId: 'site', titles: ['Review index coverage'] },
                { initiativeId: null, titles: ['Check analytics'] },
            ]);
        } finally {
            view.unmount();
        }
    }
});

test('search filters the drawer and a task already on the plan cannot be picked', async () => {
    const view = mount({
        planRows: [{ title: 'Confirm website and CMS access', templateKey: 'access.cms', status: 'todo' }],
        orgTasks: [{ id: 'tpl-1', title: 'Send the monthly report', description: 'Mail the report.' }],
    });
    try {
        const open = document.querySelector('[data-playbook-open="site"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        const project = document.querySelector('[data-playbook-project]');
        assert.ok(project instanceof dom.window.HTMLSelectElement);
        assert.equal(project.value, 'site');
        assert.deepEqual([...project.options].map(option => option.text), [
            'No project', 'Improve the website', 'Local visibility',
        ]);

        const search = document.querySelector('[data-playbook-search]');
        assert.ok(search instanceof dom.window.HTMLInputElement);
        await act(async () => { typeInto(search, 'kickoff'); });
        assert.equal(box('Hold kickoff call and set expectations').disabled, true);
        assert.equal(box('Hold kickoff call and set expectations').getAttribute('data-playbook-state'), 'plan');
        assert.equal(box('Hold the kickoff and confirm the agreement').getAttribute('data-playbook-state'), 'plan');
        assert.equal(document.body.textContent?.includes('Review the crawl rules and the page list'), false);
        assert.match(document.body.textContent ?? '', /Already in the plan/);

        await act(async () => { typeInto(search, 'website editor'); });
        assert.equal(box('Confirm access to the website editor').getAttribute('data-playbook-state'), 'plan');
        assert.equal(document.querySelectorAll('[data-playbook-title="Confirm access to the website editor"]').length, 2);

        await act(async () => { typeInto(search, 'monthly report'); });
        assert.equal(box('Send the monthly report').getAttribute('data-playbook-state'), 'open');
        assert.equal(document.querySelector('[data-playbook-section="saved"]') instanceof Element, true);
        assert.equal(document.querySelector('[data-playbook-section="library"]'), null);
    } finally {
        view.unmount();
    }
});

test('multi-select adds the chosen tasks into the project the person picks', async () => {
    const view = mount();
    try {
        const open = document.querySelector('[data-playbook-open="site"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        const search = document.querySelector('[data-playbook-search]');
        assert.ok(search instanceof dom.window.HTMLInputElement);

        await act(async () => { typeInto(search, 'page list'); });
        await act(async () => { box('Review the crawl rules and the page list').click(); });
        await act(async () => { typeInto(search, 'local landing'); });
        await act(async () => { box('Build local landing pages').click(); });

        const project = document.querySelector('[data-playbook-project]');
        assert.ok(project instanceof dom.window.HTMLSelectElement);
        await act(async () => {
            project.value = 'local';
            project.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        const add = document.querySelector('[data-playbook-add]');
        assert.ok(add instanceof dom.window.HTMLButtonElement);
        assert.match(add.textContent ?? '', /Add 2 tasks/);
        await act(async () => { add.click(); });

        assert.equal(view.calls.length, 1);
        assert.equal(view.calls[0]?.initiativeId, 'local');
        assert.deepEqual(view.calls[0]?.titles, [
            'Review the crawl rules and the page list',
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
        assert.equal((document.querySelector('[data-playbook-project]') as HTMLSelectElement | null)?.value, '');

        const search = document.querySelector('[data-playbook-search]');
        assert.ok(search instanceof dom.window.HTMLInputElement);
        await act(async () => { typeInto(search, 'kickoff'); });
        const select = document.querySelector('[data-playbook-select="section:checklist"]');
        assert.ok(select instanceof dom.window.HTMLButtonElement);
        await act(async () => { select.click(); });
        assert.equal(box('Hold kickoff call and set expectations').checked, false);
        assert.equal(box('Hold the kickoff and confirm the agreement').checked, false);

        await act(async () => { typeInto(search, 'page list'); });
        const librarySelect = document.querySelector('[data-playbook-select="group:technical"]');
        assert.ok(librarySelect instanceof dom.window.HTMLButtonElement);
        await act(async () => { librarySelect.click(); });
        assert.equal(box('Review the crawl rules and the page list').checked, true);

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
        assert.match(document.body.textContent ?? '', /Loading your saved tasks/);
        assert.equal(document.body.textContent?.includes('No saved tasks match that search.'), false);
    } finally {
        view.unmount();
    }
});

test('search is focused when the drawer opens and Escape closes it back on the button', async () => {
    const view = mount();
    try {
        const open = document.querySelector('[data-playbook-open="site"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        assert.equal(open.getAttribute('aria-label'), 'Add from a playbook to Improve the website');
        open.focus();
        await act(async () => { open.click(); });
        const search = document.querySelector('[data-playbook-search]');
        assert.ok(search instanceof dom.window.HTMLInputElement);
        assert.equal(document.activeElement, search);
        await act(async () => {
            search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });
        assert.equal(document.querySelector('[data-playbook-drawer]'), null);
        assert.equal(document.activeElement, open);
    } finally {
        view.unmount();
    }
});

test('a second batch failure says the earlier tasks were added', async () => {
    const calls: PlaybookAddCall[] = [];
    const view = mount({
        tasks: [],
        onAdd: async input => {
            calls.push(input);
            if (calls.length > 1) throw new Error('second batch');
        },
    });
    try {
        const open = document.querySelector('[data-playbook-open="plan"]');
        assert.ok(open instanceof dom.window.HTMLButtonElement);
        await act(async () => { open.click(); });
        const select = document.querySelector('[data-playbook-select="section:library"]');
        assert.ok(select instanceof dom.window.HTMLButtonElement);
        await act(async () => { select.click(); });
        const add = document.querySelector('[data-playbook-add]');
        assert.ok(add instanceof dom.window.HTMLButtonElement);
        await act(async () => { add.click(); });
        assert.equal(calls.length, 2);
        assert.equal(calls[0]?.titles.length, STAGE_ADD_MAX_TITLES);
        assert.ok((calls[1]?.titles.length ?? 0) > 0);
        assert.match(document.body.textContent ?? '', /Some tasks were added\. The rest could not be added\. Try again\./);
        assert.equal(document.querySelector('[data-playbook-drawer]') instanceof Element, true);
    } finally {
        view.unmount();
    }
});
