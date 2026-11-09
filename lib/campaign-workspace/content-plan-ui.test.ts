/**
 * Run with: node --import tsx --test lib/campaign-workspace/content-plan-ui.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { ContentPlanSection } from '../../components/campaign-workspace/ContentPlanTable.tsx';
import { OVERVIEW_MONTH_EVENT } from '../seo-plan/plan-month-url.ts';
import type { ContentPlanRow } from './content-plan.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM(
    '<!doctype html><html><body></body></html>',
    { url: 'http://localhost/workspace/harbor?tab=campaign-workspace&campaignView=work&overviewMonth=2026-10', pretendToBeVisual: true },
);
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

function piece(overrides: Partial<ContentPlanRow> = {}): ContentPlanRow {
    return {
        id: 'row-1',
        organizationId: 'org',
        clientId: 'client',
        planMonth: '2026-10',
        publishedOn: null,
        status: 'published',
        contentType: null,
        title: 'Emergency service page',
        keyword: null,
        searchVolume: null,
        keywordDifficulty: null,
        dueOn: null,
        draftUrl: null,
        liveUrl: null,
        matchingProduct: null,
        internalUrl: null,
        createdAt: '2026-10-02T15:00:00.000Z',
        ...overrides,
    };
}

async function mount(node: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(node);
    });
    return {
        container,
        async unmount() {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        },
    };
}

test('Work content follows overviewMonth and drops the other month instead of inventing rows', async () => {
    const view = await mount(createElement(ContentPlanSection, {
        today: '2026-03-04',
        rows: [piece()],
    }));
    try {
        const month = view.container.querySelector('[data-content-plan-month]');
        assert.equal(month?.getAttribute('data-content-plan-month'), '2026-10');
        assert.match(month?.textContent ?? '', /October 2026/);
        assert.equal(view.container.textContent?.includes('March 2026'), false);
        assert.match(view.container.textContent ?? '', /Emergency service page/);
        const volume = view.container.querySelector('[data-field="volume"]');
        assert.equal(volume?.getAttribute('data-unset'), 'true');
        assert.equal(volume?.textContent, '—');
        assert.equal(view.container.querySelector('[data-field="month"] input'), null);
        assert.equal(view.container.querySelector('input[type="month"]'), null);
        assert.equal(view.container.querySelector('[data-content-row]')?.getAttribute('data-verified'), 'false');
        assert.equal(view.container.querySelector('[data-content-row]')?.getAttribute('data-indexed'), 'false');
        assert.equal(view.container.querySelector('[data-content-row]')?.getAttribute('data-performing'), 'false');
        assert.equal(view.container.textContent?.includes('Completed & Verified'), false);
        assert.equal(view.container.textContent?.includes('On track'), false);
        assert.equal(view.container.textContent?.includes('EXAMPLE: How Much Does a Kitchen Remodel'), false);

        await act(async () => {
            window.history.replaceState(null, '', '/workspace/harbor?tab=campaign-workspace&campaignView=work&overviewMonth=2026-11');
            window.dispatchEvent(new window.Event(OVERVIEW_MONTH_EVENT));
        });
        const next = view.container.querySelector('[data-content-plan-month]');
        assert.equal(next?.getAttribute('data-content-plan-month'), '2026-11');
        assert.match(next?.textContent ?? '', /November 2026/);
        assert.match(view.container.textContent ?? '', /No content for November 2026/);
        assert.equal(view.container.textContent?.includes('Emergency service page'), false);
        assert.equal(view.container.querySelector('[data-field="volume"]'), null);
        assert.equal(view.container.textContent?.includes('March 2026'), false);
    } finally {
        await view.unmount();
    }
});
