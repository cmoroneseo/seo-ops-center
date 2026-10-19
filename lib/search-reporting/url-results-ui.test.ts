import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ResultCard } from '../../components/marketing-plan/ResultsView.tsx';
import type { LedgerEntry } from './ledger.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        id: 'piece',
        title: 'Chino service page',
        type: 'Content',
        subtype: 'service_page',
        kind: 'new_page',
        shippedOn: '2026-10-08',
        publishedUrl: 'https://example.com/chino',
        verdict: 'too_early',
        chip: 'Too early to judge',
        detail: 'Too early to judge. A reading waits until day 30 after Oct 8.',
        footnote: null,
        range: '2026-10',
        insightsHref: '/workspace/client?tab=insights&range=2026-10',
        datesLabel: null,
        organic: null,
        map: null,
        ...overrides,
    };
}

test('the results column shows the live URL readout and stays blank without one', () => {
    const measured = renderToStaticMarkup(createElement(ResultCard, {
        entry: entry(),
        clientId: 'client',
        property: 'sc-domain:example.com',
        sharePageFreshness: false,
        result: {
            kind: 'measured',
            clicks: 142,
            impressions: 3401,
            position: 6.2,
            queries: [{ query: 'chino plumber', clicks: 80, impressions: 900 }],
            comparison: {
                basis: 'equal_window',
                days: 3,
                beforeDays: 3,
                before: { clicks: 40, impressions: 1100, position: 9.1 },
                after: { clicks: 142, impressions: 3401, position: 6.2 },
                label: 'before 40 clicks · 1,100 impr',
            },
        },
    }));
    const column = measured.slice(measured.indexOf('data-results-column'));
    assert.match(column, /142 clicks/);
    assert.match(column, /3,401 impr · pos 6\.2/);
    assert.match(column, /chino plumber/);
    assert.match(column, /before 40 clicks · 1,100 impr/);

    const empty = renderToStaticMarkup(createElement(ResultCard, {
        entry: entry({ id: 'plain' }),
        clientId: 'client',
        property: null,
        sharePageFreshness: false,
    }));
    const blank = empty.slice(empty.indexOf('data-results-column'));
    assert.equal(blank.includes('Not indexed yet'), false);
    assert.equal(blank.includes('clicks'), false);

    const waiting = renderToStaticMarkup(createElement(ResultCard, {
        entry: entry({ id: 'new' }),
        clientId: 'client',
        property: 'sc-domain:example.com',
        sharePageFreshness: false,
        result: { kind: 'not_indexed' },
    }));
    assert.match(waiting.slice(waiting.indexOf('data-results-column')), /Not indexed yet/);
    assert.equal(waiting.includes('0 clicks'), false);
});
