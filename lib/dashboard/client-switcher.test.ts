import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ClientSwitcher } from '../../components/dashboard/ClientSwitcher.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('client switcher shows a placeholder until the client list finishes loading', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function render(isLoading: boolean, selectedId: string | null, clients: React.ComponentProps<typeof ClientSwitcher>['clients'] = []) {
        act(() => {
            root.render(createElement(ClientSwitcher, {
                clients,
                isLoading,
                selectedId,
                recentIds: [],
                hrefFor: id => `/workspace/${id}`,
                onClear: () => undefined,
                open: false,
                onOpenChange: () => undefined,
            }));
        });
        const trigger = container.querySelector('button');
        assert.ok(trigger);
        return trigger;
    }

    try {
        const loading = render(true, 'client-1');
        assert.doesNotMatch(loading.textContent ?? '', /Unknown client|Not in this list|\?/);
        assert.equal(loading.getAttribute('aria-label'), 'Loading client');

        const loaded = render(false, 'client-1', [{ id: 'client-1', name: 'Demo Client', chip: 'Active' }]);
        assert.match(loaded.textContent ?? '', /Demo Client/);
        assert.doesNotMatch(loaded.textContent ?? '', /Unknown client/);
        assert.notEqual(loaded.getAttribute('aria-label'), 'Loading client');

        assert.match(render(false, 'client-1').textContent ?? '', /Unknown client.*Not in this list/);
        assert.match(render(false, null).textContent ?? '', /No client.*Agency home/);
    } finally {
        act(() => root.unmount());
        container.remove();
    }
});
