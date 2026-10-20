/**
 * Run with: node --import tsx --test lib/tasks/description-save-ui.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { descriptionSaveLabel } from './description-save.ts';
import { useDescriptionAutosave } from './use-description-autosave.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const elementPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
elementPrototype.attachEvent ??= () => undefined;
elementPrototype.detachEvent ??= () => undefined;

function Editor({
    persist,
    nextText,
}: {
    persist: (text: string) => Promise<boolean>;
    nextText: string;
}) {
    const autosave = useDescriptionAutosave({
        savedText: 'Old notes',
        resetKey: 'task-1',
        debounceMs: 10_000,
        persist,
    });
    const label = descriptionSaveLabel(autosave.phase);
    return createElement(
        'div',
        null,
        createElement('textarea', { 'aria-label': 'Description', readOnly: true, value: autosave.text }),
        createElement('button', { type: 'button', 'data-edit': 'true', onClick: () => autosave.edit(nextText) }, 'Edit'),
        createElement('button', { type: 'button', 'data-flush': 'true', onClick: () => autosave.flush() }, 'Close'),
        label ? createElement(
            'p',
            { 'data-description-save': autosave.phase },
            label,
            autosave.phase === 'failed'
                ? createElement('button', { type: 'button', onClick: () => autosave.retry() }, 'Retry')
                : null,
        ) : null,
    );
}

async function mount(node: React.ReactElement): Promise<Root> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(node); });
    return root;
}

test('unmount flushes a description that has not reached the debounce', async () => {
    const saved: string[] = [];
    const root = await mount(createElement(Editor, {
        nextText: 'Notes typed just now',
        persist: async text => {
            saved.push(text);
            return true;
        },
    }));
    const edit = document.querySelector<HTMLButtonElement>('[data-edit]');
    assert.ok(edit);
    try {
        await act(async () => { edit.click(); });
        assert.match(document.body.textContent ?? '', /Saving…/);
        assert.equal(document.querySelector('textarea')?.value, 'Notes typed just now');
        assert.deepEqual(saved, []);
    } finally {
        await act(async () => { root.unmount(); });
    }
    assert.deepEqual(saved, ['Notes typed just now']);
});

test('a failed description save shows Retry and sends the same text again', async () => {
    const saved: string[] = [];
    let allow = false;
    const root = await mount(createElement(Editor, {
        nextText: 'Needs a retry',
        persist: async text => {
            saved.push(text);
            return allow;
        },
    }));
    try {
        const edit = document.querySelector<HTMLButtonElement>('[data-edit]');
        const close = document.querySelector<HTMLButtonElement>('[data-flush]');
        assert.ok(edit && close);
        await act(async () => { edit.click(); });
        await act(async () => {
            close.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        assert.match(document.body.textContent ?? '', /Failed to save/);
        assert.match(document.body.textContent ?? '', /Retry/);
        allow = true;
        const retry = [...document.querySelectorAll('button')].find(button => button.textContent === 'Retry');
        assert.ok(retry instanceof dom.window.HTMLButtonElement);
        await act(async () => {
            retry.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        assert.deepEqual(saved, ['Needs a retry', 'Needs a retry']);
        assert.match(document.body.textContent ?? '', /Saved/);
    } finally {
        await act(async () => { root.unmount(); });
    }
});
