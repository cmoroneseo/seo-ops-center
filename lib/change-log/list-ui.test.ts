import { dom } from './list-ui-dom.test.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ChangeLogView } from '../../components/change-log/ChangeLogView.tsx';
import type { TimelineItem } from './types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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
    const table = container.querySelector('table');
    assert.equal(table?.firstElementChild?.tagName, 'CAPTION');
    assert.match(table?.className ?? '', /caption-bottom/);
    assert.match(container.querySelector('[data-sort="live"]')?.className ?? '', /focus-visible:ring-2/);
    assert.match(container.querySelector('[data-bucket="improved"]')?.className ?? '', /focus-visible:ring-2/);
    assert.match(container.querySelector('[data-change-id] button')?.className ?? '', /focus-visible:ring-2/);
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

function setControlValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
    const prototype = element instanceof dom.window.HTMLSelectElement
        ? dom.window.HTMLSelectElement.prototype
        : dom.window.HTMLInputElement.prototype;
    element.focus();
    element.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    element.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
}

test('went live presets, a custom range, and clear compose with search, type, and result', async () => {
    const ranged: TimelineItem[] = [
        row({
            id: 'future',
            title: 'Future heading',
            liveOn: '2026-12-01',
            changeType: 'h1',
            verdict: 'too_early',
        }),
        row({
            id: 'today',
            title: 'Emergency title',
            liveOn: '2026-11-10',
            changeType: 'title',
            verdict: 'too_early',
            url: 'https://summitdental.example/emergency-dentist',
        }),
        row({
            id: 'home',
            title: 'Homepage heading',
            liveOn: '2026-10-13',
            changeType: 'h1',
            verdict: 'improved',
            headlineDays: 14,
            headlinePct: 18,
            url: 'https://summitdental.example/',
            pageLabel: 'Homepage',
        }),
        row({
            id: 'summer',
            title: 'Summer page',
            liveOn: '2026-09-01',
            changeType: 'content_refresh',
            verdict: 'flat',
            headlineDays: 28,
            headlinePct: 2,
        }),
        row({
            id: 'old',
            title: 'Old redirect',
            liveOn: '2026-01-15',
            changeType: 'redirect',
            verdict: 'declined',
            headlineDays: 28,
            headlinePct: -11,
        }),
    ];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(ChangeLogView, {
            clientName: 'Summit Dental',
            mode: 'list',
            example: true,
            items: ranged,
            today: '2026-11-10',
            onLog: () => undefined,
            onOpen: () => undefined,
            onBack: () => undefined,
            onSubmit: () => undefined,
            onRemove: () => undefined,
        }));
    });

    assert.equal(document.querySelector('input[type="date"]'), null);
    assert.equal(container.querySelector('[data-went-live]')?.getAttribute('data-went-live'), 'all');
    assert.equal(container.querySelector('[data-went-live]')?.getAttribute('aria-label'), 'Went live: All time');
    assert.deepEqual(ids(container), ['future', 'today', 'home', 'summer', 'old']);

    async function choose(preset: string) {
        await act(async () => {
            container.querySelector<HTMLButtonElement>('[data-went-live]')?.click();
        });
        const button = document.querySelector<HTMLButtonElement>(`[data-preset="${preset}"]`);
        assert.ok(button, preset);
        await act(async () => {
            button.click();
        });
    }

    await choose('30');
    assert.equal(container.querySelector('[data-went-live]')?.getAttribute('aria-label'), 'Went live: Last 30 days');
    assert.equal(document.querySelector('input[type="date"]'), null);
    assert.deepEqual(ids(container), ['today', 'home']);
    assert.equal(bucketCount(container, 'too_early'), '1');
    assert.equal(bucketCount(container, 'improved'), '1');
    assert.equal(bucketCount(container, 'flat'), '0');
    assert.equal(bucketCount(container, 'declined'), '0');
    assert.match(container.textContent ?? '', /of 2 changes/);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-bucket="improved"]')?.click();
    });
    assert.deepEqual(ids(container), ['home']);
    assert.equal(bucketCount(container, 'improved'), '1');
    assert.equal(bucketCount(container, 'too_early'), '1');
    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-bucket="improved"]')?.click();
    });
    assert.deepEqual(ids(container), ['today', 'home']);

    const type = container.querySelector('[aria-label="Change type"]');
    assert.ok(type instanceof dom.window.HTMLSelectElement);
    await act(async () => {
        setControlValue(type, 'h1');
    });
    assert.deepEqual(ids(container), ['home']);
    assert.equal(bucketCount(container, 'improved'), '1');
    assert.match(container.textContent ?? '', /of 1 change/);
    await act(async () => {
        setControlValue(type, '');
    });
    assert.deepEqual(ids(container), ['today', 'home']);

    await choose('90');
    assert.equal(container.querySelector('[data-went-live]')?.getAttribute('aria-label'), 'Went live: Last 90 days');
    assert.deepEqual(ids(container), ['today', 'home', 'summer']);
    assert.equal(bucketCount(container, 'flat'), '1');

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-went-live]')?.click();
    });
    await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-preset="custom"]')?.click();
    });
    const from = document.querySelector('#went-live-from');
    const to = document.querySelector('#went-live-to');
    assert.ok(from instanceof dom.window.HTMLInputElement);
    assert.ok(to instanceof dom.window.HTMLInputElement);
    await act(async () => {
        setControlValue(from, '2026-10-31');
    });
    await act(async () => {
        setControlValue(to, '2026-10-01');
    });
    assert.equal(container.querySelector('[data-went-live]')?.getAttribute('aria-label'), 'Went live: Oct 1, 2026 – Oct 31, 2026');
    assert.deepEqual(ids(container), ['home']);
    assert.equal(bucketCount(container, 'improved'), '1');
    assert.equal(bucketCount(container, 'too_early'), '0');

    await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-preset="clear"]')?.click();
    });
    assert.equal(container.querySelector('[data-went-live]')?.getAttribute('data-went-live'), 'all');
    assert.equal(document.querySelector('input[type="date"]'), null);
    assert.deepEqual(ids(container), ['future', 'today', 'home', 'summer', 'old']);

    const search = container.querySelector('[aria-label="Search changes or pages"]');
    assert.ok(search instanceof dom.window.HTMLInputElement);
    await act(async () => {
        setControlValue(search, 'summer');
    });
    assert.deepEqual(ids(container), ['summer']);
    assert.equal(bucketCount(container, 'flat'), '1');
    assert.match(container.textContent ?? '', /of 1 change/);

    act(() => root.unmount());
    container.remove();
});
