import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { KeywordSeedStep } from '../../components/topical-map/KeywordSeedStep.tsx';
import { loadKeywordSuggestions } from './load-keyword-suggestions.ts';
import { gscRowConnected, keywordPositionsPayload } from './keyword-positions.ts';
import {
    AHREFS_SEARCHES_NOTE,
    KEYWORD_LIMIT,
    KEYWORD_LIMIT_MESSAGE,
    SEARCH_CONSOLE_POSITION_NOTE,
    addKeywordRow,
    buildKeywordRows,
    difficultyBand,
    keywordMetricCell,
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

test('a missing source is a dash with a note, never zero or a guessed number', () => {
    const invented = buildKeywordRows({
        site: [{ keyword: 'roof repair', volume: 0, difficulty: 0 }],
        rivals: [],
        ideas: [{ keyword: 'emergency plumber', volume: 2400, difficulty: 33 }],
        positions: [{ query: 'emergency plumber', position: 4 }],
        saved: [],
        selectionTouched: false,
        ahrefs: 'missing',
        searchConsole: 'missing',
    });
    assert.equal(invented.rows.length, 2);
    for (const row of invented.rows) {
        assert.equal(row.volume, null);
        assert.equal(row.difficulty, null);
        assert.equal(row.position, null);
        assert.equal(keywordMetricCell(0, 'missing', 'volume').text, '—');
        assert.equal(keywordMetricCell(2400, 'missing', 'volume').note, AHREFS_SEARCHES_NOTE);
        assert.equal(keywordMetricCell(4, 'missing', 'position').note, SEARCH_CONSOLE_POSITION_NOTE);
        assert.equal(keywordMetricCell(4, 'missing', 'position').text, '—');
    }

    const html = renderToStaticMarkup(createElement(KeywordSeedStep, {
        ...stepProps,
        rows: [{ keyword: 'emergency plumber', volume: 2400, difficulty: 0, position: 4, selected: true }],
        ahrefs: 'missing',
        searchConsole: 'missing',
    }));
    assert.match(html, /Connect Ahrefs to see searches and difficulty/);
    assert.match(html, /Connect Google Search Console to see where you rank/);
    assert.match(html, /href="\/workspace\/client%201\?tab=integrations&amp;setup=ahrefs"[^>]*>Connect Ahrefs</);
    assert.match(html, /href="\/workspace\/client%201\?tab=integrations&amp;setup=search-console"[^>]*>Connect Google Search Console</);
    assert.equal(html.match(/Needs Ahrefs/g)?.length, 2);
    assert.equal(html.match(/Needs Google Search Console/g)?.length, 1);
    assert.match(html, /data-metric="volume"[^>]*>—</);
    assert.match(html, /data-metric="difficulty"[^>]*>—</);
    assert.match(html, /data-metric="position"[^>]*>—</);
    assert.match(html, /Difficulty<\/b> will show as Easy, Medium or Hard with a 0–100 score once Ahrefs is connected\./);
    assert.equal(html.includes('2400'), false);
    assert.equal(html.includes('>0<'), false);
    assert.equal(html.includes('>4<'), false);
    assertNoPlaceholders(html);
    assert.equal(keywordStepHint('missing', 'connected'), 'You can continue without these. The numbers fill in once the tools are connected.');
});

test('a connected source shows a measured zero and a dash when that keyword was not measured', () => {
    const rows = buildKeywordRows({
        site: [
            { keyword: 'roof repair', volume: 0, difficulty: 12 },
            { keyword: 'water heater', volume: null, difficulty: null },
        ],
        rivals: [],
        ideas: [{ keyword: 'roof repair', volume: 9999, difficulty: 80 }],
        positions: [
            { query: 'Roof Repair', position: 8.24 },
            { query: 'water heater', position: 0 },
        ],
        saved: ['roof repair'],
        selectionTouched: false,
        ahrefs: 'connected',
        searchConsole: 'connected',
    });
    const roof = rows.rows.find(row => row.keyword === 'roof repair');
    const heater = rows.rows.find(row => row.keyword === 'water heater');
    assert.equal(roof?.volume, 0);
    assert.equal(roof?.difficulty, 12);
    assert.equal(roof?.position, 8.24);
    assert.equal(roof?.selected, true);
    assert.equal(heater?.volume, null);
    assert.equal(heater?.position, null);
    assert.equal(heater?.selected, false);
    assert.equal(keywordMetricCell(0, 'connected', 'volume').text, '0');
    assert.equal(keywordMetricCell(0, 'connected', 'volume').note, null);
    assert.equal(keywordMetricCell(null, 'connected', 'volume').text, '—');
    assert.match(keywordMetricCell(null, 'connected', 'volume').note ?? '', /not measured/i);
    assert.equal(keywordMetricCell(8.24, 'connected', 'position').text, '#8 · page 1 of Google');
    assert.equal(keywordMetricCell(14.4, 'connected', 'position').text, '#14 · page 2 of Google');
    assert.equal(keywordMetricCell(null, 'connected', 'position').text, 'Not showing in Google yet');
    assert.equal(keywordMetricCell(null, 'connected', 'position').note, null);
    assert.equal(keywordMetricCell(42, 'connected', 'difficulty').text, 'Medium 42/100');

    const html = renderToStaticMarkup(createElement(KeywordSeedStep, {
        ...stepProps,
        rows: [roof as KeywordRow, heater as KeywordRow],
        ahrefs: 'connected',
        searchConsole: 'connected',
    }));
    assert.match(html, /data-metric="volume"[^>]*>0</);
    assert.match(html, /data-metric="difficulty"[^>]*>.*Easy <small[^>]*>12\/100</);
    assert.match(html, /data-metric="position"[^>]*><b[^>]*>#8<\/b> <span[^>]*>· page 1 of Google</);
    assert.match(html, /data-metric="position"[^>]*>Not showing in Google yet</);
    assert.match(html, /Searches and difficulty from <b[^>]*>Ahrefs<\/b>.*Connected/);
    assert.match(html, /Where you rank from <b[^>]*>Google Search Console<\/b>.*Connected/);
    assert.match(html, /Monthly searches:<\/b> about how many times a month people search for this\./);
    assert.match(html, /Easy 0–29 · Medium 30–59 · Hard 60–100\./);
    assert.equal(html.includes('Connect Ahrefs'), false);
    assert.equal(html.includes('Needs Ahrefs'), false);
    assert.equal(html.includes('9999'), false);
    assert.equal(html.includes('Not in top 100'), false);
    assertNoPlaceholders(html);
    assert.equal(keywordStepHint('connected', 'connected'), 'You can change keywords later from the topic map.');
});

test('difficulty bands and Google pages follow the plain-words key', () => {
    assert.deepEqual([0, 29, 30, 59, 60, 100].map(score => difficultyBand(score).band), ['Easy', 'Easy', 'Medium', 'Medium', 'Hard', 'Hard']);
    assert.deepEqual(rankParts(1), { rank: 1, page: 1 });
    assert.deepEqual(rankParts(10.4), { rank: 10, page: 1 });
    assert.deepEqual(rankParts(10.6), { rank: 11, page: 2 });
    assert.deepEqual(rankParts(0.3), { rank: 1, page: 1 });
});

test('"Why it\'s suggested" appears only when a row has a reason backed by data', () => {
    const built = buildKeywordRows({
        site: [{ keyword: 'roof repair', volume: 10, difficulty: 5 }],
        rivals: [{ keyword: 'gutter cleaning', volume: 20, difficulty: 30, competitor: 'rival.example' }],
        ideas: [{ keyword: 'ai idea' }, { keyword: 'roof repair' }],
        positions: [],
        saved: ['old pick', 'gutter cleaning'],
        selectionTouched: false,
        ahrefs: 'connected',
        searchConsole: 'connected',
    });
    const reasons = Object.fromEntries(built.rows.map(row => [row.keyword, [row.reason, row.competitor]]));
    assert.deepEqual(reasons, {
        'old pick': ['saved', null],
        'gutter cleaning': ['competitor', 'rival.example'],
        'roof repair': ['site', null],
        'ai idea': [null, null],
    });

    const withReasons = renderToStaticMarkup(createElement(KeywordSeedStep, {
        ...stepProps,
        rows: [...built.rows, addKeywordRow([], 'family dentist').rows[0]],
        ahrefs: 'connected',
        searchConsole: 'connected',
    }));
    assert.match(withReasons, /Why it&#x27;s suggested/);
    assert.match(withReasons, /On a competitor&#x27;s site<span[^>]*>rival\.example</);
    assert.match(withReasons, /Your site already ranks for this/);
    assert.match(withReasons, /You added this/);
    assert.match(withReasons, /Added by you/);

    // AI ideas alone carry no reason we can back up, so the column is left out.
    const ideasOnly = renderToStaticMarkup(createElement(KeywordSeedStep, {
        ...stepProps,
        rows: [{ keyword: 'ai idea', volume: null, difficulty: null, position: null, selected: true }],
        ahrefs: 'connected',
        searchConsole: 'connected',
    }));
    assert.equal(ideasOnly.includes('Why it'), false);
});

test('select all reports the count and the continue label counts the chosen keywords', () => {
    const rows: KeywordRow[] = [
        { keyword: 'a', volume: null, difficulty: null, position: null, selected: true },
        { keyword: 'b', volume: null, difficulty: null, position: null, selected: false },
    ];
    const html = renderToStaticMarkup(createElement(KeywordSeedStep, { ...stepProps, rows, ahrefs: 'connected', searchConsole: 'connected' }));
    assert.match(html, /role="checkbox" aria-checked="mixed"[^>]*>.*Select all/);
    assert.match(html, /<b[^>]*>1 of 2<\/b> selected/);
    assert.match(html, /placeholder="Add your own keyword"/);
    assert.match(html, />Add keyword</);
});

test('adding a keyword selects it and does not invent monthly searches', () => {
    const added = addKeywordRow([], '  leak repair  ');
    assert.equal(added.error, null);
    assert.deepEqual(added.rows, [{ keyword: 'leak repair', volume: null, difficulty: null, position: null, selected: true, reason: 'added' }]);
    const again = addKeywordRow([{ ...added.rows[0], selected: false }], 'Leak Repair');
    assert.equal(again.rows[0].selected, true);
    assert.equal(again.rows.length, 1);
    assert.equal(addKeywordRow([], '   ').error, 'Enter a keyword.');
});

test('adding past the 40-keyword cap is refused with a plain message, or replaces an unchecked suggestion', () => {
    const full: KeywordRow[] = Array.from({ length: KEYWORD_LIMIT }, (_, index) => ({
        keyword: `keyword ${index}`, volume: null, difficulty: null, position: null, selected: true,
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

test('keyword lookup uses the research routes and drops guessed or unconnected numbers', async () => {
    const calls: string[] = [];
    const missing = await loadKeywordSuggestions({
        clientId: 'client 1',
        brandName: 'Northside',
        businessDescription: 'Plumbing',
        focusTopics: ['drains'],
        rivals: ['rival.example', 'other.example'],
        saved: [],
        selectionTouched: false,
    }, async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/api/campaign/keyword-research')) return json({ error: 'Ahrefs not connected' }, 404);
        if (url.includes('/api/campaign/suggest-keywords')) {
            const body = JSON.parse(String(init?.body));
            assert.equal(body.clientId, 'client 1');
            assert.equal(body.clientName, 'Northside');
            assert.deepEqual(body.focusTopics, ['drains']);
            assert.deepEqual(body.rivals, ['rival.example', 'other.example']);
            return json({ keywords: [{ keyword: 'emergency plumber', volume: 2400, difficulty: 33 }] });
        }
        if (url.includes('/api/topical-map/keyword-positions')) {
            return json({ connected: false, positions: [{ query: 'emergency plumber', position: 4 }] });
        }
        throw new Error(url);
    });
    assert.equal(calls.some(call => call.includes('mode=competitor')), false);
    assert.equal(missing.ahrefs, 'missing');
    assert.equal(missing.searchConsole, 'missing');
    assert.equal(missing.rows[0].keyword, 'emergency plumber');
    assert.equal(missing.rows[0].volume, null);
    assert.equal(missing.rows[0].position, null);
    assert.equal(keywordMetricCell(missing.rows[0].volume, missing.ahrefs, 'volume').text, '—');

    const measured = await loadKeywordSuggestions({
        clientId: 'client',
        brandName: 'Northside',
        businessDescription: 'Plumbing',
        focusTopics: [],
        rivals: ['https://Rival.Example/path'],
        saved: ['roof repair'],
        selectionTouched: false,
    }, async (input) => {
        const url = String(input);
        if (url.includes('mode=domain')) {
            return json({ keywords: [{ keyword: 'roof repair', volume: 0, difficulty: 12 }, { keyword: 'blank', volume: '  ', difficulty: '' }] });
        }
        if (url.includes('mode=competitor')) return json({ keywords: [{ keyword: 'rival term', volume: 80, difficulty: 20 }] });
        if (url.includes('suggest-keywords')) return json({ keywords: [{ keyword: 'guessed phrase', volume: 5000, difficulty: 40 }] });
        if (url.includes('keyword-positions')) {
            return json({ connected: true, positions: [{ query: 'roof repair', position: 3 }] });
        }
        throw new Error(url);
    });
    const roof = measured.rows.find(row => row.keyword === 'roof repair');
    const guessed = measured.rows.find(row => row.keyword === 'guessed phrase');
    assert.equal(roof?.volume, 0);
    assert.equal(roof?.position, 3);
    assert.equal(roof?.selected, true);
    assert.equal(guessed?.volume, null);
    assert.equal(guessed?.difficulty, null);
    assert.equal(guessed?.selected, false);
    assert.equal(measured.rows.find(row => row.keyword === 'blank')?.volume, null);
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
