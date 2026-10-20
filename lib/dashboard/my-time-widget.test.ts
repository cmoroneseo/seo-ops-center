import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { MyTimeWidget, type MyTimeSnapshot } from '../../components/dashboard/AgencyWidgets.tsx';
import { OrganizationContext } from '../../components/providers/organization-provider.tsx';
import { publishMyTimeRefresh } from './my-time.ts';
import type { Organization } from '../types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const organization: Organization = {
    id: 'org-1',
    name: 'Demo Agency',
    slug: 'demo',
    subscriptionStatus: 'active',
    planType: 'starter',
    createdAt: '2026-10-01T00:00:00.000Z',
};

function mount(loadSnapshot: (organizationId: string) => Promise<MyTimeSnapshot>) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => {
        root.render(createElement(
            OrganizationContext.Provider,
            {
                value: {
                    organization,
                    memberships: [],
                    isLoading: false,
                    setOrganization: () => undefined,
                },
            },
            createElement(MyTimeWidget, { loadSnapshot }),
        ));
    });
    return {
        container,
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

function hours(container: HTMLElement, which: 'week' | 'month'): string {
    return container.querySelector(`[data-my-time="${which}"]`)?.textContent ?? '';
}

test('My Time keeps the tiles visible and updates them after a time entry is saved', async () => {
    let releaseRefresh: (snapshot: MyTimeSnapshot) => void = () => undefined;
    let calls = 0;
    const view = mount(organizationId => {
        assert.equal(organizationId, 'org-1');
        calls += 1;
        if (calls === 1) {
            return Promise.resolve({ hoursThisWeek: 2, hoursThisMonth: 6, byClient: [] });
        }
        return new Promise(resolve => {
            releaseRefresh = resolve;
        });
    });

    await act(async () => {
        await Promise.resolve();
    });
    assert.equal(view.container.querySelector('[data-my-time-loading]'), null);
    assert.match(hours(view.container, 'week'), /2h/);
    assert.match(hours(view.container, 'month'), /6h/);

    await act(async () => {
        publishMyTimeRefresh();
        await Promise.resolve();
    });
    assert.equal(calls, 2);
    assert.equal(view.container.querySelector('[data-my-time-loading]'), null);
    assert.match(hours(view.container, 'week'), /2h/);

    await act(async () => {
        releaseRefresh({ hoursThisWeek: 3.5, hoursThisMonth: 7.5, byClient: [] });
        await Promise.resolve();
    });
    assert.match(hours(view.container, 'week'), /3\.5h/);
    assert.match(hours(view.container, 'month'), /7\.5h/);
    assert.equal(view.container.querySelector('[data-my-time-loading]'), null);
    view.unmount();
});
