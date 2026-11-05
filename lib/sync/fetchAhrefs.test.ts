import test from 'node:test';
import assert from 'node:assert/strict';
import { AHREFS_ORGANIC_ROW_CAP } from './ahrefs-metrics';
import { fetchAhrefs, loadAhrefsTarget } from './fetchAhrefs';

test('the domain loader reads clients.domain and never website_url', async () => {
    const selects: string[] = [];
    const admin = {
        from(table: string) {
            return {
                select(columns: string) { selects.push(`${table}:${columns}`); return this; },
                eq() { return this; },
                maybeSingle: async () => ({
                    data: table === 'clients' ? { domain: 'Example.com' } : { credentials: { site_url: 'sc-domain:fallback.test' } },
                    error: null,
                }),
            };
        },
    };
    assert.equal(await loadAhrefsTarget('client', admin), 'Example.com');
    assert.deepEqual(selects.filter(item => item.startsWith('clients:')), ['clients:domain']);
    assert.equal(selects.some(item => item.includes('website_url')), false);
});

function ahrefsFetch(pages: { rating?: unknown; keywords?: unknown[] }) {
    const urls: string[] = [];
    return {
        urls,
        fetch: async (input: RequestInfo | URL) => {
            const url = String(input);
            urls.push(url);
            if (url.includes('domain-rating')) {
                return Response.json({ domain_rating: { domain_rating: pages.rating ?? null } });
            }
            return Response.json({ keywords: pages.keywords ?? [] });
        },
    };
}

test('a missing domain rating stays null and a short keyword page is counted', async () => {
    const api = ahrefsFetch({ rating: null, keywords: [{ best_position: 4 }] });
    const result = await fetchAhrefs('client', '2026-08', {
        now: () => new Date('2026-09-15T20:00:00Z'),
        loadCredentials: async () => ({ apiKey: 'key' }),
        loadTarget: async () => 'example.com',
        organicRowCap: false,
        fetch: api.fetch,
    });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') {
        assert.equal(result.data.domain_rating, null);
        assert.equal(result.data.ranked_keywords, 1);
        assert.equal(result.data.top_10_keywords, 1);
    }
    const keywordsUrl = api.urls.find(url => url.includes('organic-keywords')) ?? '';
    assert.equal(keywordsUrl.includes('limit=1000'), false);
});

test('a blank domain rating stays null and a real zero stays zero', async () => {
    const blank = await fetchAhrefs('client', '2026-08', {
        now: () => new Date('2026-09-15T20:00:00Z'),
        loadCredentials: async () => ({ apiKey: 'key' }),
        loadTarget: async () => 'example.com',
        fetch: ahrefsFetch({ rating: '  ', keywords: [] }).fetch,
    });
    const zero = await fetchAhrefs('client', '2026-08', {
        now: () => new Date('2026-09-15T20:00:00Z'),
        loadCredentials: async () => ({ apiKey: 'key' }),
        loadTarget: async () => 'example.com',
        fetch: ahrefsFetch({ rating: 0, keywords: [] }).fetch,
    });
    assert.equal(blank.status, 'ok');
    assert.equal(zero.status, 'ok');
    if (blank.status === 'ok' && zero.status === 'ok') {
        assert.equal(blank.data.domain_rating, null);
        assert.equal(zero.data.domain_rating, 0);
        assert.equal(zero.data.ranked_keywords, 0);
    }
});

test('the 1,000-row cap is sent and stored only when AHREFS_ORGANIC_ROW_CAP is on', async () => {
    const page = Array.from({ length: AHREFS_ORGANIC_ROW_CAP }, () => ({ best_position: 3 }));
    const off = ahrefsFetch({ rating: 12, keywords: page });
    const cappedOff = await fetchAhrefs('client', '2026-08', {
        now: () => new Date('2026-09-15T20:00:00Z'),
        loadCredentials: async () => ({ apiKey: 'key' }),
        loadTarget: async () => 'example.com',
        organicRowCap: false,
        fetch: off.fetch,
    });
    const on = ahrefsFetch({ rating: 12, keywords: page });
    const cappedOn = await fetchAhrefs('client', '2026-08', {
        now: () => new Date('2026-09-15T20:00:00Z'),
        loadCredentials: async () => ({ apiKey: 'key' }),
        loadTarget: async () => 'example.com',
        organicRowCap: true,
        fetch: on.fetch,
    });
    assert.equal(cappedOff.status, 'ok');
    assert.equal(cappedOn.status, 'ok');
    if (cappedOff.status === 'ok' && cappedOn.status === 'ok') {
        assert.equal(cappedOff.data.domain_rating, 12);
        assert.equal(cappedOff.data.ranked_keywords, null);
        assert.equal(cappedOff.data.top_10_keywords, null);
        assert.equal(cappedOn.data.ranked_keywords, 1000);
        assert.equal(cappedOn.data.top_10_keywords, 1000);
    }
    assert.equal((off.urls.find(url => url.includes('organic-keywords')) ?? '').includes('limit=1000'), false);
    assert.equal((on.urls.find(url => url.includes('organic-keywords')) ?? '').includes('limit=1000'), true);
});

test('an Ahrefs HTTP error hides the response body', async () => {
    const result = await fetchAhrefs('client', '2026-08', {
        loadCredentials: async () => ({ apiKey: 'key' }),
        loadTarget: async () => 'example.com',
        fetch: async () => new Response('secret ahrefs payload', { status: 500 }),
    });
    assert.equal(result.status, 'error');
    if (result.status === 'error') {
        assert.equal(result.message, 'Ahrefs request failed (HTTP 500)');
        assert.equal(result.retryable, true);
    }
});

test('no website domain is not configured', async () => {
    const result = await fetchAhrefs('client', '2026-08', {
        loadCredentials: async () => ({ apiKey: 'key' }),
        loadTarget: async () => null,
        fetch: async () => { throw new Error('must not fetch'); },
    });
    assert.deepEqual(result, { status: 'not_configured', reason: 'No website domain on the client' });
});
