import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchLiveUrlPerformance, refreshLiveUrlBatch, selectLiveUrlsToRefresh } from './live-url-sync';

const NOW = Date.parse('2026-10-10T18:00:00.000Z');

test('refresh picks the oldest live URLs and follows a moved ship date', () => {
    const selected = selectLiveUrlsToRefresh({
        now: NOW,
        limit: 2,
        subjects: [
            { url: 'https://www.example.com/chino/', goLive: '2026-10-01' },
            { url: 'http://example.com/chino?x=1', goLive: '2026-09-01' },
            { url: 'https://example.com/eastvale', goLive: '2026-10-02' },
            { url: 'https://example.com/ontario', goLive: '2026-10-03' },
            { url: 'not a url', goLive: '2026-10-01' },
        ],
        checks: [
            { urlKey: 'example.com/chino', goLive: '2026-10-01', fetchedAt: '2026-10-10T17:00:00.000Z' },
            { urlKey: 'example.com/eastvale', goLive: '2026-10-02', fetchedAt: '2026-10-09T00:00:00.000Z' },
        ],
    });
    assert.deepEqual(selected.map(item => item.urlKey), ['example.com/ontario', 'example.com/eastvale']);
    assert.equal(selected[0].goLive, '2026-10-03');

    const moved = selectLiveUrlsToRefresh({
        now: NOW,
        subjects: [{ url: 'https://example.com/chino', goLive: '2026-09-01' }],
        checks: [{ urlKey: 'example.com/chino', goLive: '2026-10-01', fetchedAt: '2026-10-10T17:00:00.000Z' }],
    });
    assert.equal(moved.length, 1);
    assert.equal(moved[0].goLive, '2026-09-01');

    const fresh = selectLiveUrlsToRefresh({
        now: NOW,
        subjects: [{ url: 'https://example.com/chino', goLive: '2026-09-01' }],
        checks: [{ urlKey: 'example.com/chino', goLive: '2026-09-01', fetchedAt: '2026-10-10T17:00:00.000Z' }],
    });
    assert.equal(fresh.length, 0);
});

test('a live URL fetch keeps that page and its top queries', async () => {
    const bodies: Record<string, unknown>[] = [];
    const result = await fetchLiveUrlPerformance(
        'sc-domain:example.com',
        'token',
        'https://www.example.com/chino/',
        { start: '2026-10-05', end: '2026-10-10' },
        { start: '2026-10-08', end: '2026-10-10' },
        {
            rowLimit: 10,
            fetch: async (url, init) => {
                assert.match(String(url), /sc-domain%3Aexample.com/);
                assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer token');
                const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
                bodies.push(body);
                const dimensions = body.dimensions as string[];
                if (dimensions[0] === 'date') {
                    return Response.json({
                        rows: [
                            { keys: ['2026-10-08', 'https://example.com/chino'], clicks: 2, impressions: 10, position: 4 },
                            { keys: ['2026-10-08', 'http://www.example.com/chino/'], clicks: 1, impressions: 5, position: 2 },
                            { keys: ['2026-10-08', 'https://example.com/chino-hills'], clicks: 9, impressions: 9, position: 1 },
                        ],
                    });
                }
                return Response.json({
                    rows: [
                        { keys: ['plumber', 'https://example.com/chino?utm=1'], clicks: 2, impressions: 8, position: 3 },
                        { keys: ['hvac', 'https://www.example.com/chino/'], clicks: 1, impressions: 4, position: 6 },
                        { keys: ['other', 'https://example.com/other'], clicks: 8, impressions: 8, position: 1 },
                    ],
                });
            },
        },
    );
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].aggregationType, 'byPage');
    assert.deepEqual(bodies[0].dimensions, ['date', 'page']);
    const filter = (bodies[0].dimensionFilterGroups as { filters: { operator: string; expression: string }[] }[])[0].filters[0];
    assert.equal(filter.operator, 'includingRegex');
    assert.equal(filter.expression.includes('example\\.com/chino'), true);
    assert.equal(bodies[1].startDate, '2026-10-08');
    assert.deepEqual(result.rows, [{
        date: '2026-10-08',
        clicks: 3,
        impressions: 15,
        position: (4 * 10 + 2 * 5) / 15,
    }]);
    assert.deepEqual(result.queries.map(query => query.query), ['plumber', 'hvac']);
});

test('an empty Search Console response is an empty result, not a failed request', async () => {
    const result = await fetchLiveUrlPerformance(
        'sc-domain:example.com',
        'token',
        'https://example.com/chino',
        { start: '2026-10-08', end: '2026-10-10' },
        { start: '2026-10-08', end: '2026-10-10' },
        { fetch: async () => Response.json({}) },
    );
    assert.deepEqual(result, { rows: [], queries: [] });
    await assert.rejects(fetchLiveUrlPerformance(
        'sc-domain:example.com',
        'token',
        'https://example.com/chino',
        { start: '2026-10-08', end: '2026-10-10' },
        { start: '2026-10-08', end: '2026-10-10' },
        { fetch: async () => new Response('quotaExceeded secret', { status: 429 }) },
    ), /HTTP 429/);
});

test('a failed URL is left unsaved so the next sync can retry it', async () => {
    const saved: string[] = [];
    const result = await refreshLiveUrlBatch({
        now: new Date(NOW),
        today: '2026-10-10',
        subjects: [
            { url: 'https://example.com/chino', goLive: '2026-10-08' },
            { url: 'https://example.com/eastvale', goLive: '2026-10-08' },
        ],
        checks: [],
        fetchUrl: async (candidate) => {
            if (candidate.urlKey === 'example.com/chino') throw new Error('HTTP 429');
            return { rows: [], queries: [] };
        },
        save: async (candidate) => { saved.push(candidate.urlKey); },
    });
    assert.deepEqual(saved, ['example.com/eastvale']);
    assert.equal(result.refreshed, 1);
});
