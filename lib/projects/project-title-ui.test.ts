import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectTitle } from '../../components/projects/ProjectTitle';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

test('project heading shows the current name and offers Rename', () => {
    const markup = renderToStaticMarkup(createElement(ProjectTitle, { title: 'Old name', onRename: async () => {} }));
    assert.match(markup, /<h2[^>]*>Old name<\/h2>/);
    assert.match(markup, /<button[^>]*aria-label="Rename project"/);
});

async function edit(run: (editor: {
    input: HTMLInputElement;
    saved: string[];
    key: (key: string) => void;
    container: HTMLElement;
}) => Promise<void>, save: (title: string) => Promise<void> = async () => {}) {
    const { window } = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
    Object.assign(globalThis, { window, document: window.document });
    Object.assign(window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
    const container = window.document.getElementById('root')!;
    const root = createRoot(container);
    const saved: string[] = [];

    function PageTitle() {
        const [title, setTitle] = useState('Old name');
        return createElement(ProjectTitle, { title, onRename: async next => {
            saved.push(next);
            await save(next);
            setTitle(next);
        } });
    }

    try {
        await act(async () => root.render(createElement(PageTitle)));
        await act(async () => container.querySelector('button')!.click());
        const input = container.querySelector('input')!;
        assert.equal(input.value, 'Old name');
        assert.equal(input.maxLength, 160);
        await run({
            input, saved, container,
            key: key => input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })),
        });
    } finally {
        await act(async () => root.unmount());
        window.close();
    }
}

for (const trigger of ['Enter', 'blur']) {
    test(`project title saves a trimmed name on ${trigger}`, async () => {
        await edit(async ({ input, saved, key, container }) => {
            input.value = '  City Pages  ';
            await act(async () => { if (trigger === 'Enter') key('Enter'); else input.blur(); });
            assert.deepEqual(saved, ['City Pages']);
            assert.equal(container.querySelector('h2')?.textContent, 'City Pages');
        });
    });
}

test('Escape restores the project name without saving', async () => {
    await edit(async ({ input, saved, key, container }) => {
        input.value = 'Discard this';
        await act(async () => { key('Escape'); input.blur(); });
        assert.deepEqual(saved, []);
        assert.equal(container.querySelector('h2')?.textContent, 'Old name');
    });
});

test('a blank project name stays in the editor with an alert', async () => {
    await edit(async ({ input, saved, key, container }) => {
        input.value = '  ';
        await act(async () => key('Enter'));
        assert.deepEqual(saved, []);
        assert.equal(container.querySelector('input'), input);
        assert.equal(container.querySelector('[role="alert"]')?.textContent, 'Project name is required.');
    });
});

test('an unchanged trimmed project name closes the editor without saving', async () => {
    await edit(async ({ input, saved, container }) => {
        input.value = '  Old name  ';
        await act(async () => input.blur());
        assert.deepEqual(saved, []);
        assert.equal(container.querySelector('input'), null);
        assert.equal(container.querySelector('h2')?.textContent, 'Old name');
    });
});

test('a pending rename blocks duplicate saves and a failed write keeps the draft', async () => {
    const { promise, reject } = Promise.withResolvers<void>();
    await edit(async ({ input, saved, key, container }) => {
        input.value = 'City Pages';
        await act(async () => { key('Enter'); key('Enter'); input.blur(); });
        assert.equal(input.disabled, true);
        assert.deepEqual(saved, ['City Pages']);
        await act(async () => reject(new Error('Could not rename the project.')));
        assert.equal(input.disabled, false);
        assert.equal(input.value, 'City Pages');
        assert.equal(container.querySelector('[role="alert"]')?.textContent, 'Could not rename the project.');
    }, () => promise);
});
