import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { KeywordSeedStep } from '../../components/topical-map/KeywordSeedStep.tsx';
import { loadKeywordSuggestions } from './load-keyword-suggestions.ts';
import { gscRowConnected, keywordPositionsPayload } from './keyword-positions.ts';
import {
    KEYWORD_LIMIT,
    KEYWORD_LIMIT_MESSAGE,
    POSITION_FAILED_NOTE,
    SEARCH_CONSOLE_POSITION_NOTE,
    addKeywordRow,
    buildKeywordRows,
    keywordPositionCell,
    keywordStepHint,
    rankParts,
    type KeywordRow,
} from './keyword-metrics.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const stepProps = {
    clientId: 'client 1',
    clientName: 'Northside Plumbing',
    loading: false,
    notice: null,
    onToggle: () => {},
    onRows: () => {},
};

/** The live screen never carries mockup labels or example numbers. */
function assertNoPlaceholders(html: string) {
    assert.doesNotMatch(html, /sample data|placeholder number|mockup/i);
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The keyword step no longer mentions a paid keyword tool, monthly searches or difficulty. */
function assertNoKeywordToolCopy(html: string) {
    assert.doesNotMatch(html, /Ahrefs|Monthly searches|monthly searches|Difficulty/);
}

test('Search Console missing is a dash with a note and a connect banner, never a guessed position', () => {
    const built = buildKeywordRows({
        ideas: ['emergency plumber'],
        positions: [{ query: 'emergency plumber', position: 4 }],
        saved: [],
        selectionTouched: false,
        searchConsole: 'missing',
    });
    assert.equal(built.rows.length, 1);
    assert.equal(built.rows[0].position, null);
    assert.equal(keywordPositionCell(4, 'missing').note, SEARCH_CONSOLE_POSITION_NOTE);
    assert.equal(keywordPositionCell(4, 'missing').text, '—');
    assert.equal(keywordPositionCell(4, 'failed').note, POSITION_FAILED_NOTE);

    const html = renderToStaticMarkup(createElement(KeywordSeedStep, {
        ...stepProps,
        rows: [{ keyword: 'emergency plumber', position: 4, selected: true }],
        searchConsole: 'missing',
    }));
    assert.match(html, /Connect Google Search Console to see where you rank/);
    assert.match(html, /href="\/workspace\/client%201\?tab=integrations&amp;setup=search-console"[^>]*>Connect Google Search Console</);
    assert.equal(html.match(/Needs Google Search Console/g)?.length, 1);
    assert.match(html, /data-metric="position"[^>]*>—</);
    assert.equal(html.includes('>4<'), false);
    assert.match(html, /How we measure demand:<\/b> the topic map uses Google Search Console/);
    assertNoKeywordToolCopy(html);
    assertNoPlaceholders(html);
    assert.equal(keywordStepHint('missing'), 'You can continue without it. Rankings fill in once Google Search Console is connected.');
});

test('Search Console connected shows where the site ranks, or says it is not showing yet', () => {
    const rows = buildKeywordRows({
        ideas: ['roof repair', 'water heater'],
        positions: [
            { query: 'Roof Repair', position: 8.24 },
            { query: 'water heater', position: 0 },
        ],
        saved: ['roof repair'],
        selectionTouched: false,
        searchConsole: 'connected',
    });
    const roof = rows.rows.find(row => row.keyword === 'roof repair');
    const heater = rows.rows.find(row => row.keyword === 'water heater');
    assert.equal(roof?.position, 8.24);
    assert.equal(roof?.selected, true);
    assert.equal(heater?.position, null);
    assert.equal(heater?.selected, false);
    assert.equal(keywordPositionCell(8.24, 'connected').text, '#8 · page 1 of Google');
    assert.equal(keywordPositionCell(14.4, 'connected').text, '#14 · page 2 of Google');
    assert.equal(keywordPositionCell(null, 'connected').text, 'Not showing in Google yet');
    assert.equal(keywordPositionCell(null, 'connected').note, null);

    const html = renderToStaticMarkup(createElement(KeywordSeedStep, {
        ...stepProps,
        rows: [roof as KeywordRow, heater as KeywordRow],
        searchConsole: 'connected',
    }));
    assert.match(html, /data-metric="position"[^>]*><b[^>]*>#8<\/b> <span[^>]*>· page 1 of Google</);
    assert.match(html, /data-metric="position"[^>]*>Not showing in Google yet</);
    assert.match(html, /Where you rank from <b[^>]*>Google Search Console<\/b>.*Connected/);
    assert.equal(html.includes('Connect Google Search Console'), false);
    assert.equal(html.includes('Not in top 100'), false);
    assertNoKeywordToolCopy(html);
    assertNoPlaceholders(html);
    assert.equal(keywordStepHint('connected'), 'You can change keywords later from the topic map.');
});

test('Google pages follow the plain-words key', () => {
    assert.deepEqual(rankParts(1), { rank: 1, page: 1 });
    assert.deepEqual(rankParts(10.4), { rank: 10, page: 1 });
    assert.deepEqual(rankParts(10.6), { rank: 11, page: 2 });
    assert.deepEqual(rankParts(0.3), { rank: 1, page: 1 });
});

test('"Why it\'s suggested" appears only when a row has a reason backed by data', () => {
    const built = buildKeywordRows({
        ideas: ['ai idea', 'old pick'],
        positions: [],
        saved: ['old pick'],
        selectionTouched: false,
        searchConsole: 'connected',
    });
    const reasons = Object.fromEntries(built.rows.map(row => [row.keyword, row.reason]));
    assert.deepEqual(reasons, { 'old pick': 'saved', 'ai idea': null });

    const withReasons = renderToStaticMarkup(createElement(KeywordSeedStep, {
        ...stepProps,
        rows: [...built.rows, addKeywordRow([], 'family dentist').rows[0]],
        searchConsole: 'connected',
    }));
    assert.match(withReasons, /Why it&#x27;s suggested/);
    assert.match(withReasons, /Chosen earlier/);
    assert.match(withReasons, /You added this/);
    assert.match(withReasons, /Added by you/);

    // AI ideas alone carry no reason we can back up, so the column is left out.
    const ideasOnly = renderToStaticMarkup(createElement(KeywordSeedStep, {
        ...stepProps,
        rows: [{ keyword: 'ai idea', position: null, selected: true }],
        searchConsole: 'connected',
    }));
    assert.equal(ideasOnly.includes('Why it'), false);
});

test('select all reports the count and the continue label counts the chosen keywords', () => {
    const rows: KeywordRow[] = [
        { keyword: 'a', position: null, selected: true },
        { keyword: 'b', position: null, selected: false },
    ];
    const html = renderToStaticMarkup(createElement(KeywordSeedStep, { ...stepProps, rows, searchConsole: 'connected' }));
    assert.match(html, /role="checkbox" aria-checked="mixed"[^>]*>.*Select all/);
    assert.match(html, /<b[^>]*>1 of 2<\/b> selected/);
    assert.match(html, /placeholder="Add your own keyword"/);
    assert.match(html, />Add keyword</);
});

test('adding a keyword selects it and does not invent a position', () => {
    const added = addKeywordRow([], '  leak repair  ');
    assert.equal(added.error, null);
    assert.deepEqual(added.rows, [{ keyword: 'leak repair', position: null, selected: true, reason: 'added' }]);
    const again = addKeywordRow([{ ...added.rows[0], selected: false }], 'Leak Repair');
    assert.equal(again.rows[0].selected, true);
    assert.equal(again.rows.length, 1);
    assert.equal(addKeywordRow([], '   ').error, 'Enter a keyword.');
});

test('adding past the 40-keyword cap is refused with a plain message, or replaces an unchecked suggestion', () => {
    const full: KeywordRow[] = Array.from({ length: KEYWORD_LIMIT }, (_, index) => ({
        keyword: `keyword ${index}`, position: null, selected: true,
    }));
    const refused = addKeywordRow(full, 'one more');
    assert.equal(refused.error, 'You can choose up to 40 keywords. Uncheck one to add another.');
    assert.equal(refused.error, KEYWORD_LIMIT_MESSAGE);
    assert.equal(refused.rows.length, 40);
    assert.equal(refused.rows.some(row => row.keyword === 'one more'), false);

    // Re-checking a keyword already in the full list is not an addition.
    const rechecked = addKeywordRow(full.map((row, index) => index === 3 ? { ...row, selected: false } : row), 'Keyword 3');
    assert.equal(rechecked.error, null);
    assert.equal(rechecked.rows.length, 40);
    assert.equal(rechecked.rows[3].selected, true);

    const withSpare = full.map((row, index) => index === 39 || index === 10 ? { ...row, selected: false } : row);
    const replaced = addKeywordRow(withSpare, 'one more');
    assert.equal(replaced.error, null);
    assert.equal(replaced.rows.length, 40);
    assert.equal(replaced.rows[0].keyword, 'one more');
    assert.equal(replaced.rows.some(row => row.keyword === 'keyword 39'), false);
    assert.equal(replaced.rows.some(row => row.keyword === 'keyword 10'), true);
    assert.equal(replaced.rows.filter(row => row.selected).length, 39);
});

const wizardInput = {
    clientId: 'client 1',
    brandName: 'Northside',
    businessDescription: 'Plumbing',
    focusTopics: ['drains'],
    rivals: ['rival.example', 'other.example'],
    saved: [],
    selectionTouched: false,
};

test('one wizard keyword lookup makes no keyword-research call: only keyword ideas and Search Console', async () => {
    const calls: string[] = [];
    const result = await loadKeywordSuggestions(wizardInput, async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/api/campaign/suggest-keywords')) {
            const body = JSON.parse(String(init?.body));
            assert.equal(body.clientId, 'client 1');
            assert.equal(body.clientName, 'Northside');
            assert.deepEqual(body.focusTopics, ['drains']);
            assert.deepEqual(body.rivals, ['rival.example', 'other.example']);
            return json({ keywords: [{ keyword: 'emergency plumber', volume: 2400, difficulty: 33 }, { keyword: '  ' }] });
        }
        if (url.includes('/api/topical-map/keyword-positions')) {
            return json({ connected: true, positions: [{ query: 'emergency plumber', position: 4 }] });
        }
        throw new Error(`unexpected request ${url}`);
    });
    assert.deepEqual(calls, [
        'POST /api/campaign/suggest-keywords',
        'GET /api/topical-map/keyword-positions?clientId=client%201',
    ]);
    assert.equal(calls.filter(call => call.includes('/api/campaign/keyword-research')).length, 0);
    assert.equal(result.searchConsole, 'connected');
    assert.equal(result.notice, null);
    // Guessed numbers from the ideas route never reach a row.
    assert.deepEqual(result.rows, [{ keyword: 'emergency plumber', position: 4, selected: true, reason: null }]);
});

test('a keyword lookup that fails can no longer say monthly searches could not be loaded', async () => {
    const result = await loadKeywordSuggestions(wizardInput, async () => json({ error: 'down' }, 502));
    assert.equal(result.searchConsole, 'failed');
    assert.equal(result.notice, 'Keyword ideas could not be loaded. You can still add your own. Your current position could not be loaded.');
    assert.doesNotMatch(result.notice ?? '', /Monthly searches/i);
});

test('the map wizard and its keyword step no longer reference the keyword-research route or Ahrefs', () => {
    for (const file of [
        'components/topical-map/MapGenerationWizard.tsx',
        'components/topical-map/KeywordSeedStep.tsx',
        'lib/onboarding/load-keyword-suggestions.ts',
        'lib/onboarding/keyword-metrics.ts',
    ]) {
        const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /keyword-research|ahrefs|Monthly searches could not be loaded/i, file);
    }
});

test('Search Console positions are empty until a property is connected', () => {
    assert.equal(gscRowConnected(null), false);
    assert.equal(gscRowConnected({ site_url: 'sc-domain:example.com', sync_status: 'disconnected' }), false);
    assert.equal(gscRowConnected({ site_url: '  ', sync_status: 'active' }), false);
    assert.equal(gscRowConnected({ site_url: 'sc-domain:example.com', sync_status: 'active' }), true);
    assert.deepEqual(keywordPositionsPayload({
        connected: false,
        queries: [{ query: 'roof repair', position: 4 }],
    }), { connected: false, positions: [] });
    assert.deepEqual(keywordPositionsPayload({
        connected: true,
        queries: [{ query: ' roof repair ', position: 4 }, { query: 'blank', position: 0 }],
    }), { connected: true, positions: [{ query: 'roof repair', position: 4 }] });
});
