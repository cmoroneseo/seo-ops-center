import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { seoPlanTabHidesToasts } from './plan-tab.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Root = import('react-dom/client').Root;
let act: typeof import('react').act;
let createElement: typeof import('react').createElement;
let createRoot: typeof import('react-dom/client').createRoot;
let ToastGateProvider: typeof import('../../components/providers/toast-gate.tsx').ToastGateProvider;
let ToastGate: typeof import('../../components/providers/toast-gate.tsx').ToastGate;
let useSuppressPlanToasts: typeof import('../../components/providers/toast-gate.tsx').useSuppressPlanToasts;

async function ensureLoaded(): Promise<void> {
    if (act) return;
    const React = await import('react');
    const reactDom = await import('react-dom/client');
    const gate = await import('../../components/providers/toast-gate.tsx');
    (globalThis as { React: typeof React }).React = React;
    act = React.act;
    createElement = React.createElement;
    createRoot = reactDom.createRoot;
    ToastGateProvider = gate.ToastGateProvider;
    ToastGate = gate.ToastGate;
    useSuppressPlanToasts = gate.useSuppressPlanToasts;
}

function Toasts({ plan }: { plan: boolean }) {
    useSuppressPlanToasts(plan);
    return createElement(ToastGate, null,
        createElement('div', { 'data-toast': 'retainer' }, "Maya's Construction is at 80% of their monthly retainer."),
        createElement('div', { 'data-toast': 'success' }, 'Task saved'),
    );
}

test('the plan tab is the only workspace view that hides toasts', () => {
    assert.equal(seoPlanTabHidesToasts({ activeTab: 'campaign', planView: 'plan', stageListOn: true }), true);
    assert.equal(seoPlanTabHidesToasts({ activeTab: 'campaign', planView: 'plan', stageListOn: false }), true);
    assert.equal(seoPlanTabHidesToasts({ activeTab: 'campaign', planView: 'tasks', stageListOn: true }), true);
    assert.equal(seoPlanTabHidesToasts({ activeTab: 'overview', planView: 'plan', stageListOn: true }), false);
    assert.equal(seoPlanTabHidesToasts({ activeTab: 'insights', planView: 'plan', stageListOn: true }), false);
    assert.equal(seoPlanTabHidesToasts({ activeTab: 'campaign', planView: 'tasks', stageListOn: false }), false);
    assert.equal(seoPlanTabHidesToasts({ activeTab: 'campaign', planView: 'results', stageListOn: false }), false);
    assert.equal(seoPlanTabHidesToasts({ activeTab: 'tasks', planView: 'plan', stageListOn: true }), false);
});

test('toasts are suppressed on the plan tab but not elsewhere', async () => {
    await ensureLoaded();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    await act(async () => {
        root.render(createElement(ToastGateProvider, null, createElement(Toasts, { plan: true })));
    });
    assert.equal(host.querySelector('[data-toast]'), null);
    assert.equal(host.textContent?.includes('retainer'), false);
    assert.equal(host.textContent?.includes('Task saved'), false);

    await act(async () => {
        root.render(createElement(ToastGateProvider, null, createElement(Toasts, { plan: false })));
    });
    assert.ok(host.querySelector('[data-toast="retainer"]'));
    assert.ok(host.querySelector('[data-toast="success"]'));
    assert.match(host.textContent ?? '', /monthly retainer/);
    assert.match(host.textContent ?? '', /Task saved/);

    await act(async () => {
        root.render(createElement(ToastGateProvider, null, createElement(Toasts, { plan: true })));
    });
    assert.equal(host.querySelector('[data-toast]'), null);

    await act(async () => { root.unmount(); });
    host.remove();
});
