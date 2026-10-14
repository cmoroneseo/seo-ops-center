import test from 'node:test';
import assert from 'node:assert/strict';
import { BingRequestError, bingJson, isBingBackoffError } from './client.ts';
import { readBingSite } from './sync.ts';

const KEY = 'synthetic-bing-key';
const SITE = 'https://example.test/blog';
const DAY = '/Date(1316156400000-0700)/';

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

test('HTTP failures do not carry the key, the URL, or the body', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
        seen = init;
        return jsonResponse(429, { apikey: KEY, message: `leak ${KEY}` });
    };
    await assert.rejects(
        () => bingJson({ method: 'GetUserSites', apiKey: KEY, fetchImpl }),
        (error: unknown) => {
            assert.ok(error instanceof BingRequestError);
            assert.equal(error.message, 'Bing Webmaster request failed (HTTP 429)');
            assert.equal(error.status, 429);
            assert.equal(isBingBackoffError(error), true);
            return true;
        },
    );
    assert.equal(seen?.redirect, 'manual');
    assert.equal(seen?.method, 'GET');

    const unavailable: typeof fetch = async () => jsonResponse(503, { apikey: KEY });
    await assert.rejects(
        () => bingJson({ method: 'GetRankAndTrafficStats', apiKey: KEY, siteUrl: SITE, fetchImpl: unavailable }),
        (error: unknown) => error instanceof BingRequestError && error.message === 'Bing Webmaster request failed (HTTP 503)',
    );

    const redirect: typeof fetch = async () => new Response(null, {
        status: 302,
        headers: { location: `https://evil.test/?apikey=${KEY}` },
    });
    await assert.rejects(
        () => bingJson({ method: 'GetUserSites', apiKey: KEY, fetchImpl: redirect }),
        (error: unknown) => error instanceof Error && error.message === 'Bing Webmaster request failed (HTTP 302)',
    );

    const network: typeof fetch = async () => {
        throw new TypeError(`fetch failed https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${KEY}`);
    };
    await assert.rejects(
        () => bingJson({ method: 'GetUserSites', apiKey: KEY, fetchImpl: network }),
        (error: unknown) => error instanceof Error && error.message === 'Bing Webmaster request failed',
    );

    const badJson: typeof fetch = async () => new Response('not-json', { status: 200 });
    await assert.rejects(
        () => bingJson({ method: 'GetUserSites', apiKey: KEY, fetchImpl: badJson }),
        (error: unknown) => error instanceof Error && error.message === 'Bing Webmaster response was not JSON',
    );
});

test('a site read stops on backoff and keeps a failed query side empty', async () => {
    const calls: string[] = [];
    const quota: typeof fetch = async (input) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname.endsWith('GetRankAndTrafficStats')) return jsonResponse(429, { apikey: KEY });
        return jsonResponse(200, { d: [] });
    };
    assert.deepEqual(await readBingSite(SITE, KEY, quota), { action: 'skip', backoff: true, status: 429 });
    assert.deepEqual(calls, ['/webmaster/api.svc/json/GetRankAndTrafficStats']);

    const calls503: string[] = [];
    const partial: typeof fetch = async (input) => {
        const url = new URL(String(input));
        calls503.push(url.pathname);
        if (url.pathname.endsWith('GetRankAndTrafficStats')) {
            return jsonResponse(200, { d: [{ Date: DAY, Clicks: 4, Impressions: 8 }] });
        }
        return jsonResponse(503, { apikey: KEY });
    };
    assert.deepEqual(await readBingSite(SITE, KEY, partial), {
        action: 'write',
        backoff: true,
        status: 503,
        traffic: [{ data_date: '2011-09-16', clicks: 4, impressions: 8 }],
        queries: null,
        pages: null,
    });
    assert.deepEqual(calls503, [
        '/webmaster/api.svc/json/GetRankAndTrafficStats',
        '/webmaster/api.svc/json/GetQueryStats',
    ]);

    const calls500: string[] = [];
    const queryDown: typeof fetch = async (input) => {
        const url = new URL(String(input));
        calls500.push(url.pathname);
        if (url.pathname.endsWith('GetQueryStats')) return jsonResponse(500, { apikey: KEY });
        if (url.pathname.endsWith('GetPageStats')) {
            return jsonResponse(200, { d: [{ Query: 'https://example.test/a', Clicks: 1, Impressions: 2, Date: DAY }] });
        }
        return jsonResponse(200, { d: [{ Date: DAY, Clicks: 4, Impressions: 8 }] });
    };
    const written = await readBingSite(SITE, KEY, queryDown);
    assert.equal(written.action, 'write');
    if (written.action !== 'write') return;
    assert.equal(written.backoff, false);
    assert.equal(written.queries, null);
    assert.deepEqual(written.pages, [{
        week_ending: '2011-09-16',
        page: 'https://example.test/a',
        clicks: 1,
        impressions: 2,
        avg_impression_position: null,
        avg_click_position: null,
    }]);
    assert.deepEqual(calls500.map(path => path.split('/').pop()), [
        'GetRankAndTrafficStats',
        'GetQueryStats',
        'GetPageStats',
    ]);

    const invalid: typeof fetch = async () => jsonResponse(200, { d: [{ Date: DAY, Clicks: -1, Impressions: 1 }] });
    assert.deepEqual(await readBingSite(SITE, KEY, invalid), { action: 'fail' });
});
