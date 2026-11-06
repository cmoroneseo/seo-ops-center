/**
 * Run with: node --import tsx --test lib/keyword-tracking/track-query.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SearchInsightsV2 } from '../../components/search-insights/SearchInsightsV2.tsx';
import { TrackQueryButton } from '../../components/keyword-tracking/TrackQueryButton.tsx';
import { exampleInsights } from '../search-insights/fixture.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('Track is absent unless keyword tracking is on', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        const off = renderToStaticMarkup(createElement(TrackQueryButton, {
            organizationId: 'org',
            clientId: 'client',
            query: 'plumber eastvale',
        }));
        assert.equal(off, '');

        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
        const on = renderToStaticMarkup(createElement(TrackQueryButton, {
            organizationId: 'org',
            clientId: 'client',
            query: 'plumber eastvale',
        }));
        assert.match(on, /data-track-query="plumber eastvale"/);
        assert.match(on, />Track</);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('Search Insights query rows promote into tracked keywords, and page rows do not', () => {
    const tab = readFileSync(new URL('../../components/workspace/SearchInsightsTab.tsx', import.meta.url), 'utf8');
    const v2 = readFileSync(new URL('../../components/search-insights/SearchInsightsV2.tsx', import.meta.url), 'utf8');
    assert.equal(tab.match(/trackedQuerySummary\(/g)?.length, 4);
    assert.equal(tab.match(/<TrackQueryButton/g)?.length, 1);
    const pageBlock = tab.slice(tab.indexOf('Page-level visibility'), tab.indexOf('Queries with deeper visibility'));
    assert.equal(pageBlock.includes('trackedQuerySummary'), false);
    assert.match(v2, /<TrackQueryButton/);
    assert.match(v2, /section === 'movers'/);
});

test('mover query rows render Track only while the flag is on', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    const fixture = exampleInsights();
    const props = {
        clientId: 'example',
        clientName: 'Scott Cole Plumbing',
        organizationId: 'org',
        onConnections() {},
        fixture,
        initialSection: 'movers' as const,
    };
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        const off = renderToStaticMarkup(createElement(SearchInsightsV2, props));
        assert.equal(off.includes('data-track-query'), false);

        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
        const on = renderToStaticMarkup(createElement(SearchInsightsV2, props));
        assert.match(on, /data-track-query="/);
        assert.match(on, />Track</);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});
