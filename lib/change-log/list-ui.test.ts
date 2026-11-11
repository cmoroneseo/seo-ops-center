import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ChangeLogView } from '../../components/change-log/ChangeLogView.tsx';
import type { TimelineItem } from './types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/change-log-example', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.navigator = dom.window.navigator;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
const elementPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
elementPrototype.attachEvent ??= () => undefined;
elementPrototype.detachEvent ??= () => undefined;

function row(partial: Partial<TimelineItem> & Pick<TimelineItem, 'id' | 'title' | 'liveOn'>): TimelineItem {
    return {
        changeType: 'title',
        liveAt: `${partial.liveOn}T18:00:00.000Z`,
        pageLabel: 'Page',
        url: `https://summitdental.example/${partial.id}`,
        verdict: 'flat',
        estimate: false,
        deltaText: '',
        kpi: 'clicks',
        checkpointDays: null,
        headlineDays: null,
        headlinePct: null,
        nextCheckOn: '2026-12-01',
        nextCheckDays: 28,
        ...partial,
    };
}

const items: TimelineItem[] = [
    row({
        id: 'zebra',
        title: 'Zebra title',
        liveOn: '2026-11-04',
        changeType: 'title',
        kpi: 'clicks',
        verdict: 'too_early',
        nextCheckOn: '2026-11-11',
        nextCheckDays: 7,
        url: 'https://summitdental.example/emergency-dentist',
    }),
    row({
        id: 'alpha',
        title: 'Alpha update',
        liveOn: '2026-10-28',
        changeType: 'content_refresh',
        kpi: 'impressions',
        verdict: 'improved',
        estimate: true,
        headlineDays: 7,
        headlinePct: 9,
        checkpointDays: 7,
        nextCheckOn: '2026-11-11',
        nextCheckDays: 14,
        url: 'https://summitdental.example/invisalign',
    }),
    row({
        id: 'middle',
        title: 'Middle heading',
        liveOn: '2026-10-13',
        changeType: 'h1',
        kpi: 'ctr',
        verdict: 'declined',
        headlineDays: 14,
        headlinePct: -14,
        checkpointDays: 14,
        nextCheckOn: '2026-11-10',
        nextCheckDays: 28,
        url: 'https://summitdental.example/',
        pageLabel: 'Homepage',
    }),
];

function ids(container: HTMLElement): string[] {
    return [...container.querySelectorAll<HTMLElement>('[data-change-id]')].map(row => row.dataset.changeId ?? '');
}

function bucketCount(container: HTMLElement, bucket: string): string {
    return container.querySelector<HTMLElement>(`[data-bucket="${bucket}"]`)?.dataset.count ?? '';
}

test('column headers sort and a result count filters the same rows it counted', async () => {
    const opened: string[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(ChangeLogView, {
            clientName: 'Summit Dental',
            mode: 'list',
            example: true,
            items,
            today: '2026-11-10',
            onLog: () => undefined,
            onOpen: (id: string) => { opened.push(id); },
            onBack: () => undefined,
            onSubmit: () => undefined,
            onRemove: () => undefined,
        }));
    });

    assert.deepEqual(ids(container), ['zebra', 'alpha', 'middle']);
    assert.equal(container.querySelector('[data-sort="live"]')?.closest('th')?.getAttribute('aria-sort'), 'descending');
    assert.equal(bucketCount(container, 'declined'), '1');
    assert.equal(bucketCount(container, 'early_estimate'), '1');
    assert.equal(bucketCount(container, 'too_early'), '1');
    assert.equal(bucketCount(container, 'improved'), '0');
    assert.match(container.textContent ?? '', /data ~Nov 13/);
    assert.match(container.textContent ?? '', /Not ready yet/);
    assert.match(container.textContent ?? '', /Early estimate \+9%/);
    assert.match(container.textContent ?? '', /Declined −14%/);
    const pills = [...container.querySelectorAll('[data-result]')].map(node => node.textContent ?? '').join(' ');
    assert.equal(pills.includes('0%'), false);
    assert.match(container.textContent ?? '', /\/emergency-dentist/);
    assert.match(container.textContent ?? '', /Homepage/);

    for (const key of ['change', 'type', 'live', 'watching', 'result', 'next']) {
        await act(async () => {
            container.querySelector<HTMLButtonElement>(`[data-sort="${key}"]`)?.click();
        });
        assert.equal(
            container.querySelector(`[data-sort="${key}"]`)?.closest('th')?.getAttribute('aria-sort'),
            'ascending',
            key,
        );
    }
    assert.deepEqual(ids(container), ['middle', 'zebra', 'alpha']);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-sort="type"]')?.click();
    });
    assert.deepEqual(ids(container), ['alpha', 'middle', 'zebra']);
    assert.equal(container.querySelector('[data-sort="type"]')?.closest('th')?.getAttribute('aria-sort'), 'ascending');

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-sort="live"]')?.click();
    });
    assert.equal(container.querySelector('[data-sort="live"]')?.closest('th')?.getAttribute('aria-sort'), 'ascending');
    assert.deepEqual(ids(container), ['middle', 'alpha', 'zebra']);
    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-sort="live"]')?.click();
    });
    assert.deepEqual(ids(container), ['zebra', 'alpha', 'middle']);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-bucket="declined"]')?.click();
    });
    assert.equal(container.querySelector('[data-bucket="declined"]')?.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(ids(container), ['middle']);
    assert.equal(bucketCount(container, 'declined'), '1');
    assert.equal(bucketCount(container, 'early_estimate'), '1');
    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-bucket="declined"]')?.click();
    });
    assert.equal(container.querySelector('[data-bucket="declined"]')?.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(ids(container), ['zebra', 'alpha', 'middle']);

    const search = container.querySelector('[aria-label="Search changes or pages"]');
    assert.ok(search instanceof dom.window.HTMLInputElement);
    await act(async () => {
        search.focus();
        const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
        setter?.call(search, 'alpha');
        search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        search.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        search.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
    });
    assert.equal(search.value, 'alpha');
    assert.deepEqual(ids(container), ['alpha']);
    assert.equal(bucketCount(container, 'early_estimate'), '1');
    assert.equal(bucketCount(container, 'declined'), '0');
    assert.equal(bucketCount(container, 'too_early'), '0');
    assert.match(container.textContent ?? '', /of 1 change/);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-change-id="alpha"] button')?.click();
    });
    assert.deepEqual(opened, ['alpha']);

    act(() => root.unmount());
    container.remove();
});
