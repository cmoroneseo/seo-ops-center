import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { CompletionDatePrompt } from '../../components/tasks/CompletionDatePrompt.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const elementPrototype = dom.window.HTMLElement.prototype as HTMLElement & {
    attachEvent?: (event: string, handler: () => void) => void;
    detachEvent?: (event: string, handler: () => void) => void;
};
elementPrototype.attachEvent ??= () => {};
elementPrototype.detachEvent ??= () => {};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date('2026-10-21T18:00:00.000Z');
const ZONE = 'America/Los_Angeles';

async function mount(node: React.ReactElement): Promise<Root> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(node); });
    return root;
}

function setDate(input: HTMLInputElement, value: string) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    const tracker = (input as HTMLInputElement & { _valueTracker?: { setValue: (value: string) => void } })._valueTracker;
    tracker?.setValue('');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
}

test('Today confirms in one click and Yesterday waits for Confirm', async () => {
    const confirmed: string[] = [];
    let cancelled = 0;
    const root = await mount(createElement(CompletionDatePrompt, {
        now: NOW,
        timeZone: ZONE,
        onConfirm: (completedAt: string) => { confirmed.push(completedAt); },
        onCancel: () => { cancelled += 1; },
    }));
    try {
        const prompt = document.querySelector('[data-completion-date-prompt]');
        assert.equal(prompt?.textContent?.includes('When was this finished?'), true);
        const today = document.querySelector('[data-completion-choice="today"]');
        assert.ok(today instanceof dom.window.HTMLButtonElement);
        await act(async () => { today.click(); });
        assert.deepEqual(confirmed, ['2026-10-21T18:00:00.000Z']);

        confirmed.length = 0;
        const yesterday = document.querySelector('[data-completion-choice="yesterday"]');
        assert.ok(yesterday instanceof dom.window.HTMLButtonElement);
        await act(async () => { yesterday.click(); });
        assert.deepEqual(confirmed, []);
        const confirm = document.querySelector('[data-completion-confirm]');
        assert.ok(confirm instanceof dom.window.HTMLButtonElement);
        await act(async () => { confirm.click(); });
        assert.deepEqual(confirmed, ['2026-10-20T19:00:00.000Z']);
    } finally {
        await act(async () => { root.unmount(); });
    }
    assert.equal(cancelled, 0);
});

test('a future date is refused and Cancel leaves the choice unsaved', async () => {
    const confirmed: string[] = [];
    let cancelled = 0;
    const root = await mount(createElement(CompletionDatePrompt, {
        now: NOW,
        timeZone: ZONE,
        onConfirm: (completedAt: string) => { confirmed.push(completedAt); },
        onCancel: () => { cancelled += 1; },
    }));
    try {
        const input = document.querySelector('[data-completion-date]');
        assert.ok(input instanceof dom.window.HTMLInputElement);
        assert.equal(input.max, '2026-10-21');
        await act(async () => { setDate(input, '2026-10-22'); });
        const confirm = document.querySelector('[data-completion-confirm]');
        assert.ok(confirm instanceof dom.window.HTMLButtonElement);
        await act(async () => { confirm.click(); });
        assert.deepEqual(confirmed, []);
        assert.match(document.body.textContent ?? '', /Pick today or a past day/);

        const cancel = document.querySelector('[data-completion-cancel]');
        assert.ok(cancel instanceof dom.window.HTMLButtonElement);
        await act(async () => { cancel.click(); });
        assert.equal(cancelled, 1);
        assert.deepEqual(confirmed, []);
    } finally {
        await act(async () => { root.unmount(); });
    }
});
