import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGSC } from './fetchGSC';
import { GoogleAuthError } from './token';

const getToken = async () => ({ token: 'test-token', creds: { site_url: 'sc-domain:example.com' } });

test('GSC query uses the selected property and returns monthly totals', async () => {
    const calls: string[] = [];
    const data = await fetchGSC('client', '2026-08', {
        getToken: async (_id, service) => { assert.equal(service, 'gsc'); return getToken(); },
        fetch: async (url, init) => {
            calls.push(String(url));
            const body = JSON.parse(String(init?.body));
            assert.equal(body.startDate, '2026-08-01');
            assert.equal(body.endDate, '2026-08-31');
            assert.equal(body.type, 'web');
            return Response.json({ rows: [{ clicks: 12, impressions: 100, position: 4.2 }] });
        },
    });
    assert.match(calls[0], /sc-domain%3Aexample.com/);
    assert.deepEqual(data, { status: 'ok', data: { organic_clicks: 12, impressions: 100, avg_position: 4.2, ctr: 0.12 } });
});

test('missing GSC authorization never falls back to GA4', async () => {
    const services: string[] = [];
    const result = await fetchGSC('client', '2026-08', {
        getToken: async (_id, service) => { services.push(service); return null; },
        fetch: async () => { throw new Error('must not fetch'); },
    });
    assert.deepEqual(services, ['gsc']);
    assert.deepEqual(result, { status: 'not_configured', reason: 'Search Console not connected' });
});

test('Google errors stay typed and do not include the upstream body', async () => {
    const result = await fetchGSC('client', '2026-08', {
        getToken,
        fetch: async () => new Response('private upstream detail', { status: 403 }),
    });
    assert.equal(result.status, 'error');
    if (result.status === 'error') {
        assert.equal(result.retryable, false);
        assert.match(result.message, /HTTP 403/);
        assert.doesNotMatch(result.message, /private upstream/);
    }
});

test('a closed month with no rows is a real zero and ratios stay null', async () => {
    const result = await fetchGSC('client', '2026-08', {
        getToken,
        now: () => new Date('2026-09-15T20:00:00Z'),
        fetch: async () => Response.json({ rows: [] }),
    });
    assert.deepEqual(result, { status: 'ok', data: { organic_clicks: 0, impressions: 0, avg_position: null, ctr: null } });
});

test('the current month with no rows is not written yet', async () => {
    const result = await fetchGSC('client', '2026-08', {
        getToken,
        now: () => new Date('2026-08-15T20:00:00Z'),
        fetch: async () => Response.json({ rows: [] }),
    });
    assert.deepEqual(result, { status: 'no_data', reason: 'no data yet for this month' });
});

test('HTTP 429 is a retryable error', async () => {
    const result = await fetchGSC('client', '2026-08', {
        getToken,
        fetch: async () => new Response('slow down', { status: 429 }),
    });
    assert.deepEqual(result, { status: 'error', message: 'Search Console request failed (HTTP 429)', retryable: true });
});

test('v2 monthly finality replaces the Search Analytics month query', async () => {
    let fetched = false;
    const result = await fetchGSC('client', '2026-09', {
        getToken,
        v2Enabled: true,
        deriveMonth: async () => ({
            status: 'ok',
            data: { organic_clicks: 30, impressions: 300, avg_position: 4, ctr: 0.1 },
            provenance: { source: 'gsc_history', finality: { final: true, days_present: 30, days_expected: 30, complete_through: '2026-09-30' } },
        }),
        fetch: async () => { fetched = true; return Response.json({ rows: [] }); },
    });
    assert.equal(fetched, false);
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') assert.equal(result.provenance?.finality && (result.provenance.finality as { final: boolean }).final, true);
});

test('with v2 off the metrics row still comes from the monthly API', async () => {
    let fetched = false;
    const result = await fetchGSC('client', '2026-08', {
        getToken,
        v2Enabled: false,
        deriveMonth: async () => { throw new Error('history must not be read'); },
        now: () => new Date('2026-09-15T20:00:00Z'),
        fetch: async () => { fetched = true; return Response.json({ rows: [{ clicks: 2, impressions: 10, position: 3 }] }); },
    });
    assert.equal(fetched, true);
    assert.deepEqual(result, { status: 'ok', data: { organic_clicks: 2, impressions: 10, avg_position: 3, ctr: 0.2 } });
});

test('v2 does not invent a zero when history has no days', async () => {
    const result = await fetchGSC('client', '2026-09', {
        getToken,
        v2Enabled: true,
        deriveMonth: async () => ({ status: 'no_data', reason: 'no stored Search Console history for this month' }),
        fetch: async () => { throw new Error('must not fetch'); },
    });
    assert.deepEqual(result, { status: 'no_data', reason: 'no stored Search Console history for this month' });
});

test('a reauth failure is an error result rather than a thrown exception', async () => {
    const result = await fetchGSC('client', '2026-08', {
        getToken: async () => { throw new GoogleAuthError('Google authorization expired. Reconnect this integration.', 'reauth_required'); },
        fetch: async () => { throw new Error('must not fetch'); },
    });
    assert.equal(result.status, 'error');
    if (result.status === 'error') assert.equal(result.reauth, true);
});
