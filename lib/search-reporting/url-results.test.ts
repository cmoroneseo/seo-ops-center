import assert from 'node:assert/strict';
import test from 'node:test';

import {
    aggregateUrlResults,
    liveUrlCoverage,
    NOT_INDEXED_COPY,
    summarizeUrlResult,
    urlResultCopy,
    type UrlResultReadout,
} from './url-results';

const TODAY = '2026-10-10';
const GO_LIVE = '2026-10-08';

function measured(overrides: Partial<Extract<UrlResultReadout, { kind: 'measured' }>> = {}): UrlResultReadout {
    return {
        kind: 'measured',
        clicks: 0,
        impressions: 0,
        position: null,
        queries: [],
        comparison: null,
        ...overrides,
    };
}

test('go-live totals run from the ship date through today', () => {
    const windows = liveUrlCoverage(GO_LIVE, TODAY);
    assert.deepEqual(windows, {
        afterStart: GO_LIVE,
        afterEnd: TODAY,
        beforeStart: '2026-10-05',
        beforeEnd: '2026-10-07',
        coverageStart: '2026-10-05',
        coverageEnd: TODAY,
    });
    assert.equal(liveUrlCoverage('2026-10-11', TODAY), null);

    const result = summarizeUrlResult({
        connected: true,
        checked: true,
        goLive: GO_LIVE,
        today: TODAY,
        coverageStart: '2026-10-05',
        rows: [
            { date: '2026-10-07', clicks: 100, impressions: 100, position: 9 },
            { date: '2026-10-08', clicks: 4, impressions: 20, position: 3 },
            { date: '2026-10-10', clicks: 0, impressions: 10, position: 5 },
        ],
        queries: [
            { query: 'chino plumber', clicks: 3, impressions: 12, position: 2 },
            { query: 'plumber', clicks: 1, impressions: 8, position: 6 },
            { query: 'hvac chino', clicks: 0, impressions: 4, position: 11 },
            { query: 'emergency plumber', clicks: 2, impressions: 5, position: 4 },
            { query: '  ', clicks: 9, impressions: 9, position: 1 },
        ],
    });
    assert.equal(result.kind, 'measured');
    if (result.kind !== 'measured') return;
    assert.equal(result.clicks, 4);
    assert.equal(result.impressions, 30);
    assert.equal(result.position, 3.7);
    assert.deepEqual(result.queries.map(query => query.query), ['chino plumber', 'emergency plumber', 'plumber']);
    assert.equal(result.comparison?.basis, 'equal_window');
    assert.equal(result.comparison?.before.clicks, 100);
    assert.equal(result.comparison?.days, 3);
    assert.equal(result.comparison?.beforeDays, 3);
    assert.equal(urlResultCopy(result), '4 clicks · 30 impr · pos 3.7 · chino plumber, emergency plumber, plumber · before 100 clicks · 100 impr');
});

test('a before window shows the equal-length totals when Search Console had the URL', () => {
    const result = summarizeUrlResult({
        connected: true,
        checked: true,
        goLive: GO_LIVE,
        today: TODAY,
        rows: [
            { date: '2026-10-05', clicks: 1, impressions: 10, position: 8 },
            { date: '2026-10-06', clicks: 1, impressions: 10, position: 4 },
            { date: '2026-10-08', clicks: 4, impressions: 20, position: 3 },
        ],
        queries: [],
    });
    assert.equal(result.kind, 'measured');
    if (result.kind !== 'measured') return;
    assert.equal(result.comparison?.basis, 'equal_window');
    assert.equal(result.comparison?.before.clicks, 2);
    assert.equal(result.comparison?.before.impressions, 20);
    assert.equal(result.comparison?.before.position, 6);
    assert.equal(result.comparison?.after.clicks, 4);
    assert.equal(result.comparison?.label, 'before 2 clicks · 20 impr');
});

test('a clipped before window compares per-day averages', () => {
    const result = summarizeUrlResult({
        connected: true,
        checked: true,
        goLive: GO_LIVE,
        today: TODAY,
        coverageStart: '2026-10-07',
        rows: [
            { date: '2026-10-07', clicks: 2, impressions: 10, position: 4 },
            { date: '2026-10-08', clicks: 6, impressions: 10, position: 3 },
        ],
        queries: [],
    });
    assert.equal(result.kind, 'measured');
    if (result.kind !== 'measured') return;
    assert.equal(result.comparison?.basis, 'per_day');
    assert.equal(result.comparison?.beforeDays, 1);
    assert.equal(result.comparison?.days, 3);
    assert.equal(result.comparison?.label, '2.0 → 2.0 clicks/day');
});

test('no Search Console rows is not indexed, and a missing connection shows nothing', () => {
    const notIndexed = summarizeUrlResult({
        connected: true,
        checked: true,
        goLive: GO_LIVE,
        today: TODAY,
        rows: [],
        queries: [],
    });
    assert.deepEqual(notIndexed, { kind: 'not_indexed' });
    assert.equal(urlResultCopy(notIndexed), NOT_INDEXED_COPY);
    assert.equal(NOT_INDEXED_COPY, 'Not indexed yet');

    const seen = summarizeUrlResult({
        connected: true,
        checked: true,
        goLive: GO_LIVE,
        today: TODAY,
        rows: [{ date: GO_LIVE, clicks: 0, impressions: 4, position: 18 }],
        queries: [],
    });
    assert.equal(seen.kind, 'measured');
    if (seen.kind === 'measured') assert.equal(seen.clicks, 0);

    assert.equal(summarizeUrlResult({
        connected: false,
        checked: true,
        goLive: GO_LIVE,
        today: TODAY,
        rows: [],
        queries: [],
    }).kind, 'hidden');
    assert.equal(summarizeUrlResult({
        connected: true,
        checked: false,
        goLive: GO_LIVE,
        today: TODAY,
        rows: [],
        queries: [],
    }).kind, 'hidden');
    assert.equal(urlResultCopy({ kind: 'hidden' }), null);
});

test('a pillar adds each subtask URL and keeps a comparison only when every URL has one', () => {
    const first = summarizeUrlResult({
        connected: true,
        checked: true,
        goLive: GO_LIVE,
        today: TODAY,
        rows: [
            { date: '2026-10-06', clicks: 2, impressions: 8, position: 5 },
            { date: '2026-10-09', clicks: 5, impressions: 20, position: 3 },
        ],
        queries: [{ query: 'chino plumber', clicks: 4, impressions: 10, position: 2 }],
    });
    const second = summarizeUrlResult({
        connected: true,
        checked: true,
        goLive: GO_LIVE,
        today: TODAY,
        rows: [
            { date: '2026-10-05', clicks: 1, impressions: 4, position: 9 },
            { date: '2026-10-10', clicks: 3, impressions: 10, position: 4 },
        ],
        queries: [
            { query: 'chino plumber', clicks: 2, impressions: 6, position: 3 },
            { query: 'eastvale hvac', clicks: 1, impressions: 4, position: 7 },
        ],
    });
    const combined = aggregateUrlResults([first, second, { kind: 'not_indexed' }]);
    assert.equal(combined.kind, 'measured');
    if (combined.kind !== 'measured' || first.kind !== 'measured' || second.kind !== 'measured') return;
    assert.equal(combined.clicks, first.clicks + second.clicks);
    assert.equal(combined.impressions, first.impressions + second.impressions);
    assert.equal(combined.comparison?.basis, 'equal_window');
    assert.equal(combined.comparison?.before.clicks, 3);
    assert.deepEqual(combined.queries.map(query => query.query), ['chino plumber', 'eastvale hvac']);
    assert.equal(combined.queries[0].clicks, 6);

    const partial = aggregateUrlResults([
        first,
        measured({ clicks: 9, impressions: 12, position: 4 }),
    ]);
    assert.equal(partial.kind, 'measured');
    if (partial.kind !== 'measured') return;
    assert.equal(partial.clicks, first.clicks + 9);
    assert.equal(partial.comparison, null);

    assert.equal(aggregateUrlResults([{ kind: 'not_indexed' }, { kind: 'hidden' }]).kind, 'not_indexed');
    assert.equal(aggregateUrlResults([{ kind: 'hidden' }]).kind, 'hidden');
    assert.equal(urlResultCopy(aggregateUrlResults([{ kind: 'not_indexed' }])), NOT_INDEXED_COPY);
});
