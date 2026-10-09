import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGA4 } from './fetchGA4';

const token = async () => ({ token: 'test-token', creds: { property_id: 'properties/1' } });

function reports(organic: unknown, total: unknown, status = 200) {
    return async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const organicCall = Boolean(body.dimensionFilter);
        if (status !== 200) return new Response('private ga4 body', { status });
        return Response.json(organicCall ? organic : total);
    };
}

test('a missing GA4 connection is not configured', async () => {
    const result = await fetchGA4('client', '2026-08', {
        getToken: async () => null,
        fetch: async () => { throw new Error('must not fetch'); },
    });
    assert.deepEqual(result, { status: 'not_configured', reason: 'GA4 not connected' });
});

test('a failed report is an error and not a null result', async () => {
    const result = await fetchGA4('client', '2026-08', {
        getToken: token,
        fetch: reports({}, {}, 500),
    });
    assert.equal(result.status, 'error');
    if (result.status === 'error') {
        assert.match(result.message, /HTTP 500/);
        assert.doesNotMatch(result.message, /private ga4/);
        assert.equal(result.retryable, true);
    }
});

test('sessions with no organic rows are a real zero and a missing bounce rate stays null', async () => {
    const result = await fetchGA4('client', '2026-08', {
        getToken: token,
        now: () => new Date('2026-09-15T20:00:00Z'),
        fetch: reports(
            { rows: [] },
            { rows: [{ metricValues: [{ value: '40' }, { value: '12' }] }] },
        ),
    });
    assert.deepEqual(result, {
        status: 'ok',
        data: { sessions: 40, new_users: 12, bounce_rate: null, organic_sessions: 0 },
    });
});
