import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

import { SearchInsightsV2 } from '../../components/search-insights/SearchInsightsV2.tsx';
import { SearchInsightsTab } from '../../components/workspace/SearchInsightsTab.tsx';
import { disconnectedInsights, exampleInsights } from './fixture.ts';

const fixture = exampleInsights();

function render(node: React.ReactElement): string {
    return renderToStaticMarkup(node);
}

test('the default view exposes the sub-nav, chart keyboard, and at most 30 receipts', () => {
    const html = render(createElement(SearchInsightsV2, {
        clientId: 'example',
        clientName: 'Scott Cole Plumbing',
        onConnections() {},
        fixture,
        example: true,
    }));
    assert.match(html, /data-search-insights="v2"/);
    assert.match(html, />EXAMPLE</);
    assert.match(html, /role="tablist"/);
    assert.match(html, /aria-label="Search Insights sections"/);
    assert.match(html, /Tracker check/);
    assert.match(html, /View as table/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /impressions/);
    assert.match(html, /var\(--chart-1\)/);
    assert.match(html, /var\(--map\)/);
    assert.match(html, /role="button"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.equal(html.includes('text-blue-'), false);
    assert.equal(html.includes('bg-blue-'), false);
    assert.equal(html.includes('#121217'), false);
    const receipts = html.match(/aria-haspopup="dialog"/g) ?? [];
    assert.ok(receipts.length > 0);
    assert.ok(receipts.length <= 30);
    assert.match(html, /1 · 3 · 10 · 20 · lower is better/);
    assert.match(html, /Partial · not collected yet/);
    assert.match(html, /Still visible on Google/);
    assert.match(html, /text-green-600/);
});

test('pages keep a sticky table and say that lower position is better', () => {
    const html = render(createElement(SearchInsightsV2, {
        clientId: 'example',
        clientName: 'Scott Cole Plumbing',
        onConnections() {},
        fixture,
        example: true,
        initialSection: 'pages',
    }));
    assert.match(html, /insights-table-scroll/);
    assert.match(html, /Avg position \(lower is better\)/);
    assert.match(html, /Business Profile link →/);
    assert.match(html, /color-mix\(in oklch, var\(--foreground\)/);
    assert.equal(html.includes('text-red-'), false);
    assert.equal(html.includes('bg-green-'), false);
});

test('not connected renders one connect panel and no chart', () => {
    const html = render(createElement(SearchInsightsV2, {
        clientId: 'example',
        clientName: 'Scott Cole Plumbing',
        onConnections() {},
        fixture: disconnectedInsights(),
    }));
    assert.match(html, /Connect Search Console/);
    assert.match(html, /Search Console isn’t connected/);
    assert.equal(html.includes('<svg'), false);
    assert.equal(html.includes('aria-haspopup="dialog"'), false);
    assert.equal(html.includes('View as table'), false);
});

test('the flag-off tab does not mount the v2 screen', () => {
    const previous = process.env.NEXT_PUBLIC_SEARCH_REPORTING;
    delete process.env.NEXT_PUBLIC_SEARCH_REPORTING;
    try {
        const html = render(createElement(SearchInsightsTab, {
            organizationId: 'org',
            clientId: 'client',
            clientName: 'Scott Cole Plumbing',
            onConnections() {},
        }));
        assert.equal(html.includes('data-search-insights="v2"'), false);
        assert.match(html, /Find work worth investigating/);
        assert.match(html, /Loading saved search performance/);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_SEARCH_REPORTING;
        else process.env.NEXT_PUBLIC_SEARCH_REPORTING = previous;
    }
});
