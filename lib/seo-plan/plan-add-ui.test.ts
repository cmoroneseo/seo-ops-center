import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    navigator: globalThis.navigator,
    act: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT,
};
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { PlanAddSubmission } from '../../components/seo-plan/PlanAddLine.tsx';
import type { PlanAddLine as PlanAddLineComponent } from '../../components/seo-plan/PlanAddLine.tsx';

type Root = import('react-dom/client').Root;
let act: typeof import('react').act;
let createElement: typeof import('react').createElement;
let createRoot: typeof import('react-dom/client').createRoot;
let PlanAddLine: typeof PlanAddLineComponent;

async function ensureLoaded(): Promise<void> {
    if (act) return;
    const React = await import('react');
    const reactDom = await import('react-dom/client');
    const view = await import('../../components/seo-plan/PlanAddLine.tsx');
    (globalThis as { React: typeof React }).React = React;
    act = React.act;
    createElement = React.createElement;
    createRoot = reactDom.createRoot;
    PlanAddLine = view.PlanAddLine;
}

const SAMPLE = [
    'Citations round 2',
    '  - Houzz photos + project gallery',
    '  - Porch.com listing',
    '  - Thumbtack profile',
    'Update GBP holiday hours',
    'Add financing FAQ to service pages',
].join('\n');

function input(): HTMLInputElement {
    const found = document.querySelector('[data-plan-add]');
    assert.ok(found instanceof dom.window.HTMLInputElement);
    return found;
}

function chip(): HTMLButtonElement {
    const found = document.querySelector('[data-plan-add-chip]');
    assert.ok(found instanceof dom.window.HTMLButtonElement);
    return found;
}

function typeInto(node: HTMLInputElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(node, text);
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function key(node: HTMLElement, keyName: string, init: KeyboardEventInit = {}) {
    node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init }));
}

function paste(node: HTMLInputElement, text: string) {
    const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === 'text' || type === 'text/plain' ? text : '') },
    });
    node.dispatchEvent(event);
}

async function mount(onAdd: (input: PlanAddSubmission) => Promise<void>): Promise<Root> {
    await ensureLoaded();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(createElement(PlanAddLine, {
            month: '2026-10',
            timeZone: 'America/Los_Angeles',
            now: new Date('2026-10-19T18:00:00.000Z'),
            onAdd,
        }));
    });
    return root;
}

test.after(() => {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.Element = previous.Element;
    globalThis.Node = previous.Node;
    Object.defineProperty(globalThis, 'navigator', { value: previous.navigator, configurable: true });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous.act;
});

test('tab cycles the chip and a successful add resets it to the end of the month', async () => {
    const calls: PlanAddSubmission[] = [];
    const root = await mount(async submission => { calls.push(submission); });
    try {
        assert.equal(chip().getAttribute('data-plan-add-chip'), 'month');
        assert.equal(chip().getAttribute('data-plan-add-label'), 'Due Oct 31');
        assert.equal(chip().getAttribute('data-plan-add-due'), '2026-10-31');

        await act(async () => { key(input(), 'Tab'); });
        assert.equal(chip().getAttribute('data-plan-add-chip'), 'backlog');
        assert.equal(chip().getAttribute('data-plan-add-label'), 'Backlog no date');
        assert.equal(chip().getAttribute('data-plan-add-due'), '');

        await act(async () => { key(input(), 'Tab'); });
        assert.equal(chip().getAttribute('data-plan-add-chip'), 'onboarding');
        assert.equal(chip().getAttribute('data-plan-add-label'), 'Onboarding');

        await act(async () => { key(input(), 'Tab'); });
        assert.equal(chip().getAttribute('data-plan-add-chip'), 'month');

        await act(async () => {
            key(input(), 'Tab');
            chip().click();
        });
        const onboarding = document.querySelector('[data-plan-add-option="onboarding"]');
        assert.ok(onboarding instanceof dom.window.HTMLButtonElement);
        await act(async () => { onboarding.click(); });
        assert.equal(chip().getAttribute('data-plan-add-chip'), 'onboarding');
        assert.equal(document.querySelector('[role="listbox"]'), null);

        await act(async () => {
            typeInto(input(), '  Update GBP holiday hours  ');
            key(input(), 'Enter');
        });
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], {
            stage: 'onboarding',
            dueDate: null,
            items: [{ title: 'Update GBP holiday hours', depth: 0 }],
        });
        assert.equal(input().value, '');
        assert.equal(chip().getAttribute('data-plan-add-chip'), 'month');
        assert.equal(chip().getAttribute('data-plan-add-due'), '2026-10-31');
        assert.equal(document.activeElement, input());
    } finally {
        await act(async () => { root.unmount(); });
        document.body.replaceChildren();
    }
});

test('a multi-line paste previews pillars and creates only when confirmed', async () => {
    const calls: PlanAddSubmission[] = [];
    const root = await mount(async submission => { calls.push(submission); });
    try {
        await act(async () => { paste(input(), SAMPLE); });
        assert.equal(calls.length, 0);
        assert.equal(input().value, '');
        const preview = document.querySelector('[data-plan-add-preview]');
        assert.ok(preview);
        assert.equal(document.querySelector('[data-plan-add-preview-title]')?.textContent, 'Add 6 tasks');
        assert.match(preview?.textContent ?? '', /1 pillar · 3 subtasks · due Oct 31/);
        assert.match(preview?.textContent ?? '', /Indented lines become subtasks of the line above/);
        assert.equal(document.querySelector('[data-plan-add-line="0"]')?.getAttribute('data-pillar'), 'true');
        assert.equal(document.querySelector('[data-plan-add-line="1"]')?.getAttribute('data-depth'), '1');
        assert.equal(document.querySelector('[data-plan-add-line="4"]')?.getAttribute('data-depth'), '0');
        assert.equal(document.querySelector('[data-plan-add-line="4"]')?.hasAttribute('data-pillar'), false);

        const porch = document.querySelector('[aria-label="Remove Porch.com listing"]');
        assert.ok(porch instanceof dom.window.HTMLButtonElement);
        await act(async () => { porch.click(); });
        assert.equal(document.querySelector('[data-plan-add-preview-title]')?.textContent, 'Add 5 tasks');
        assert.match(document.querySelector('[data-plan-add-preview]')?.textContent ?? '', /1 pillar · 2 subtasks/);
        assert.equal(document.querySelector('[aria-label="Remove Porch.com listing"]'), null);

        await act(async () => { key(input(), 'Enter'); });
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.stage, 'backlog');
        assert.equal(calls[0]?.dueDate, '2026-10-31');
        assert.deepEqual(calls[0]?.items.map(item => item.title), [
            'Citations round 2',
            'Houzz photos + project gallery',
            'Thumbtack profile',
            'Update GBP holiday hours',
            'Add financing FAQ to service pages',
        ]);
        assert.deepEqual(calls[0]?.items.map(item => item.depth), [0, 1, 1, 0, 0]);
        assert.equal(document.querySelector('[data-plan-add-preview]'), null);
    } finally {
        await act(async () => { root.unmount(); });
        document.body.replaceChildren();
    }
});

test('escape cancels the preview and a single pasted line stays out of it', async () => {
    let calls = 0;
    const root = await mount(async () => { calls += 1; });
    try {
        await act(async () => { paste(input(), 'Only one line'); });
        assert.equal(document.querySelector('[data-plan-add-preview]'), null);
        assert.equal(calls, 0);

        await act(async () => { paste(input(), SAMPLE); });
        assert.ok(document.querySelector('[data-plan-add-preview]'));
        await act(async () => { key(input(), 'Escape'); });
        assert.equal(document.querySelector('[data-plan-add-preview]'), null);
        assert.equal(calls, 0);
        assert.equal(document.activeElement, input());
    } finally {
        await act(async () => { root.unmount(); });
        document.body.replaceChildren();
    }
});

test('more than 40 lines or a 300-character title disables add', async () => {
    const root = await mount(async () => undefined);
    try {
        const many = Array.from({ length: 41 }, (_, index) => `Task ${index + 1}`).join('\n');
        await act(async () => { paste(input(), many); });
        assert.equal(document.querySelector('[data-plan-add-preview-title]')?.textContent, 'Add up to 40 tasks at a time.');
        const submit = document.querySelector('[data-plan-add-submit]');
        assert.ok(submit instanceof dom.window.HTMLButtonElement);
        assert.equal(submit.disabled, true);
        await act(async () => { submit.click(); key(input(), 'Enter'); });
        assert.ok(document.querySelector('[data-plan-add-preview]'));

        await act(async () => { key(input(), 'Escape'); });
        const long = `${'x'.repeat(301)}\nShort title`;
        await act(async () => { paste(input(), long); });
        assert.equal(document.querySelector('[data-plan-add-preview-title]')?.textContent, 'Keep each title under 300 characters.');
        const blocked = document.querySelector('[data-plan-add-submit]');
        assert.ok(blocked instanceof dom.window.HTMLButtonElement);
        assert.equal(blocked.disabled, true);
    } finally {
        await act(async () => { root.unmount(); });
        document.body.replaceChildren();
    }
});

test('a failed add keeps the text and says which batch failed', async () => {
    const root = await mount(async () => { throw new Error('db down'); });
    try {
        await act(async () => {
            typeInto(input(), 'Update GBP holiday hours');
            key(input(), 'Enter');
        });
        assert.equal(input().value, 'Update GBP holiday hours');
        assert.equal(document.querySelector('[data-plan-add-error]')?.textContent, "Couldn't add that task.");
        assert.equal(chip().getAttribute('data-plan-add-chip'), 'month');

        await act(async () => { paste(input(), SAMPLE); });
        await act(async () => { key(input(), 'Enter'); });
        assert.equal(document.querySelector('[data-plan-add-error]')?.textContent, "Couldn't add those tasks.");
        assert.equal(document.querySelector('[data-plan-add-preview-title]')?.textContent, 'Add 6 tasks');
        assert.match(document.querySelector('[data-plan-add-preview]')?.textContent ?? '', /Citations round 2/);
        assert.equal(chip().getAttribute('data-plan-add-chip'), 'month');
    } finally {
        await act(async () => { root.unmount(); });
        document.body.replaceChildren();
    }
});
