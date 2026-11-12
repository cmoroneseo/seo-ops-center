import { dom } from './list-ui-dom.test.ts';

globalThis.MutationObserver = dom.window.MutationObserver;
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ChangeLogView } from '../../components/change-log/ChangeLogView.tsx';
import { exampleBoard, exampleConfounders, EXAMPLE_TODAY } from './fixture.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const board = exampleBoard();
const h1 = board.changes[0];

test('download and more menus open, and remove asks before it deletes', async () => {
    const removed: string[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(ChangeLogView, {
            clientName: 'Ecoworkz',
            mode: 'detail',
            example: false,
            items: board.items,
            today: EXAMPLE_TODAY,
            detail: {
                change: h1,
                impact: board.impacts[h1.id],
                confounders: exampleConfounders(board, h1.id),
                baselineNote: 'Example starting point.',
            },
            onLog: () => undefined,
            onOpen: () => undefined,
            onBack: () => undefined,
            onSubmit: () => undefined,
            onRemove: () => { removed.push('removed'); },
        }));
    });

    assert.equal(container.querySelector('details.change-log-record')?.hasAttribute('open'), false);
    assert.equal(container.querySelector('[data-metric="clicks"]')?.getAttribute('data-watched'), 'true');
    assert.equal(container.querySelector('[data-metric="avg_position"]')?.getAttribute('data-watched'), 'false');
    assert.match(container.textContent ?? '', /Lower is better/);
    assert.equal((container.textContent ?? '').includes('Remove from log'), false);
    assert.match(container.textContent ?? '', /Data ready ~Dec 11/);
    assert.equal((container.textContent ?? '').includes('Data ready ~Dec 10'), false);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-menu="download"]')?.click();
    });
    assert.match(document.body.textContent ?? '', /Spreadsheet \(CSV\)/);
    assert.match(document.body.textContent ?? '', /Print or save as PDF/);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-menu="more"]')?.click();
    });
    const remove = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Remove from log…'));
    assert.ok(remove);
    await act(async () => {
        remove.click();
    });
    assert.match(document.body.textContent ?? '', /Remove this change from the log\?/);
    assert.match(document.body.textContent ?? '', /doesn’t change the live site|doesn(?:'|’)t change the live site/);
    assert.deepEqual(removed, []);

    const confirm = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Remove from log');
    assert.ok(confirm);
    await act(async () => {
        confirm.click();
    });
    assert.deepEqual(removed, ['removed']);

    act(() => root.unmount());
    container.remove();
});

test('arrow keys move through the download menu', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(ChangeLogView, {
            clientName: 'Ecoworkz',
            mode: 'detail',
            example: false,
            items: board.items,
            today: EXAMPLE_TODAY,
            detail: {
                change: h1,
                impact: board.impacts[h1.id],
                confounders: exampleConfounders(board, h1.id),
                baselineNote: 'Example starting point.',
            },
            onLog: () => undefined,
            onOpen: () => undefined,
            onBack: () => undefined,
            onSubmit: () => undefined,
            onRemove: () => undefined,
        }));
    });
    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-menu="download"]')?.click();
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    const items = [...menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []];
    assert.equal(items.length, 2);
    assert.equal(document.activeElement, items[0]);
    await act(async () => {
        menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    assert.equal(document.activeElement, items[1]);
    await act(async () => {
        menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    assert.equal(document.activeElement, items[0]);
    await act(async () => {
        menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    assert.equal(document.activeElement, items[1]);
    await act(async () => {
        menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    assert.equal(document.activeElement, items[0]);
    act(() => root.unmount());
    container.remove();
});

test('chart tabs switch the story, and position says higher is better', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(ChangeLogView, {
            clientName: 'Ecoworkz',
            mode: 'detail',
            example: true,
            items: board.items,
            today: EXAMPLE_TODAY,
            detail: {
                change: h1,
                impact: board.impacts[h1.id],
                confounders: exampleConfounders(board, h1.id),
                baselineNote: 'Example starting point.',
            },
            onLog: () => undefined,
            onOpen: () => undefined,
            onBack: () => undefined,
            onSubmit: () => undefined,
            onRemove: () => undefined,
        }));
    });
    assert.equal(container.querySelector('[data-chart-tab]')?.getAttribute('data-chart-tab'), 'daily');
    assert.equal((container.textContent ?? '').includes('Higher on the chart is better'), false);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-chart-metric-option="avg_position"]')?.click();
    });
    assert.match(container.textContent ?? '', /Higher on the chart is better/);
    assert.match(container.textContent ?? '', /Average position from Google, day by day/);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-chart-tab-option="aligned"]')?.click();
    });
    assert.match(container.textContent ?? '', /lined up with the 28 days after/);
    assert.match(container.textContent ?? '', /before and after/);
    assert.equal(container.querySelector('[data-chart-tab]')?.getAttribute('data-chart-tab'), 'aligned');
    assert.equal(container.querySelector('[data-live-marker="false"]')?.getAttribute('data-live-marker'), 'false');
    assert.equal((container.querySelector('#change-chart-panel-aligned')?.textContent ?? '').includes('Went live'), false);
    assert.equal((container.textContent ?? '').includes('Side by side'), false);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-chart-tab-option="indexed"]')?.click();
    });
    assert.match(container.querySelector('[data-chart-caption]')?.textContent ?? '', /100 = the page's normal level before the change/);
    assert.match(container.textContent ?? '', /Rest of the site/);
    assert.equal((container.textContent ?? '').includes('No comparison'), false);

    act(() => root.unmount());
    container.remove();
});

test('a chart with nothing to compare leaves out the caption and the No comparison legend', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(ChangeLogView, {
            clientName: 'Ecoworkz',
            mode: 'detail',
            example: true,
            items: [],
            today: EXAMPLE_TODAY,
            canEdit: false,
            detail: {
                change: h1,
                impact: { ...board.impacts[h1.id], controlLabel: 'No comparison' },
                confounders: [],
                baselineNote: 'Example starting point.',
            },
            onLog: () => undefined,
            onOpen: () => undefined,
            onBack: () => undefined,
            onSubmit: () => undefined,
            onRemove: () => undefined,
        }));
    });
    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-chart-tab-option="indexed"]')?.click();
    });
    assert.equal(container.querySelector('[data-chart-caption]'), null);
    assert.equal((container.textContent ?? '').includes('No comparison'), false);
    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-menu="more"]')?.click();
    });
    assert.equal((document.body.textContent ?? '').includes('Remove from log'), false);
    act(() => root.unmount());
    container.remove();
});
