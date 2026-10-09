import test from 'node:test';
import assert from 'node:assert/strict';
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

test('a missing domain rating stays null', async () => {
    const result = await fetchAhrefs('client', '2026-08', {
        now: () => new Date('2026-09-15T20:00:00Z'),
        loadCredentials: async () => ({ apiKey: 'key' }),
        loadTarget: async () => 'example.com',
        fetch: async (input) => {
            const url = String(input);
            if (url.includes('domain-rating')) return Response.json({ domain_rating: {} });
            return Response.json({ keywords: [{ best_position: 4 }] });
        },
    });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') {
        assert.equal(result.data.domain_rating, null);
        assert.equal(result.data.ranked_keywords, 1);
        assert.equal(result.data.top_10_keywords, 1);
    }
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
