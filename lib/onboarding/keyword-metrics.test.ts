import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { KeywordSeedStep } from '../../components/topical-map/KeywordSeedStep.tsx';
import { loadKeywordSuggestions } from './load-keyword-suggestions.ts';
import { gscRowConnected, keywordPositionsPayload } from './keyword-positions.ts';
import {
    AHREFS_SEARCHES_NOTE,
    SEARCH_CONSOLE_POSITION_NOTE,
    addKeywordRow,
    buildKeywordRows,
    keywordMetricCell,
    type KeywordRow,
} from './keyword-metrics.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

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
        rows: [{ keyword: 'emergency plumber', volume: 2400, difficulty: 0, position: 4, selected: true }],
        ahrefs: 'missing',
        searchConsole: 'missing',
        loading: false,
        notice: null,
        onToggle: () => {},
        onRows: () => {},
    }));
    assert.match(html, /Connect Ahrefs to see monthly searches/);
    assert.match(html, /Connect Ahrefs to see how hard each search is/);
    assert.match(html, /Connect Search Console to see your current position/);
    assert.match(html, /data-metric="volume"[^>]*>—</);
    assert.match(html, /data-metric="difficulty"[^>]*>—</);
    assert.match(html, /data-metric="position"[^>]*>—</);
    assert.equal(html.includes('2400'), false);
    assert.equal(html.includes('>0<'), false);
    assert.equal(html.includes('>4<'), false);
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
    assert.equal(keywordMetricCell(8.24, 'connected', 'position').text, '8.2');

    const html = renderToStaticMarkup(createElement(KeywordSeedStep, {
        rows: [roof as KeywordRow],
        ahrefs: 'connected',
        searchConsole: 'connected',
        loading: false,
        notice: null,
        onToggle: () => {},
        onRows: () => {},
    }));
    assert.match(html, /data-metric="volume"[^>]*>0</);
    assert.match(html, /data-metric="difficulty"[^>]*>12</);
    assert.match(html, /data-metric="position"[^>]*>8\.2</);
    assert.equal(html.includes('Connect Ahrefs'), false);
    assert.equal(html.includes('9999'), false);
});

test('adding a keyword selects it and does not invent monthly searches', () => {
    const added = addKeywordRow([], '  leak repair  ');
    assert.equal(added.error, null);
    assert.deepEqual(added.rows, [{ keyword: 'leak repair', volume: null, difficulty: null, position: null, selected: true }]);
    const again = addKeywordRow([{ ...added.rows[0], selected: false }], 'Leak Repair');
    assert.equal(again.rows[0].selected, true);
    assert.equal(again.rows.length, 1);
    assert.equal(addKeywordRow([], '   ').error, 'Enter a keyword.');
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
