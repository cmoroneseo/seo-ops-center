import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAuthError } from '@/lib/sync/token';
import { readLiveGa4, readLiveGsc, type LiveDeps } from './live';

const secret = 'ya29.live-secret';

function deps(fetchImpl: LiveDeps['fetch']): LiveDeps {
    return {
        fetch: fetchImpl,
        async getToken() {
            return { token: secret, creds: { property_id: 'properties/15', site_url: 'sc-domain:example.com', access_token: secret, refresh_token: 'refresh-secret' } };
        },
    };
}

test('live GA4 returns totals and not the Google bearer', async () => {
    const seen: string[] = [];
    const result = await readLiveGa4('client', '2026-10-01', '2026-10-07', deps(async (_url, init) => {
        seen.push(String((init?.headers as Record<string, string>).Authorization));
        const body = JSON.parse(String(init?.body));
        const organic = Boolean(body.dimensionFilter);
        return Response.json({
            rows: [{ metricValues: organic ? [{ value: '4' }] : [{ value: '9' }, { value: '3' }, { value: '1' }] }],
        });
    }));
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.totals.organicSessions, 4);
        assert.equal(result.totals.sessions, 9);
        assert.equal(result.property, 'properties/15');
    }
    assert.equal(seen[0], `Bearer ${secret}`);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(result).includes('refresh-secret'), false);
});

test('live Search Console maps an empty report to measured zeros', async () => {
    const result = await readLiveGsc('client', '2026-10-01', '2026-10-07', deps(async () => Response.json({ rows: [] })));
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.totals.clicks, 0);
        assert.equal(result.totals.impressions, 0);
        assert.equal(result.totals.position, null);
    }
});

test('a Google reauth error stays generic', async () => {
    const result = await readLiveGa4('client', '2026-10-01', '2026-10-07', {
        fetch,
        async getToken() {
            throw new GoogleAuthError('Google authorization expired. Reconnect this integration.', 'reauth_required');
        },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.status, 401);
        assert.equal(result.error.includes(secret), false);
    }
});
