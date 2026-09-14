import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import * as queries from '../../app/api/cron/attribution-queries/route.ts';
import * as cleanup from '../../app/api/cron/attribution-cleanup/route.ts';

test('both Vercel GET cron handlers preserve secret auth and execute their scheduled work', async () => {
    const originalFetch = globalThis.fetch;
    const original = { ...process.env };
    const calls: string[] = [];
    try {
        process.env.CRON_SECRET = 'test-cron-secret';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://cron-test.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
        globalThis.fetch = async (input, init) => {
            const request = new Request(input, init);
            const url = new URL(request.url);
            calls.push(`${request.method} ${url.pathname}`);
            if (request.method === 'DELETE') {
                if (url.pathname.endsWith('/attribution_rate_limits')) {
                    assert.ok(url.searchParams.get('window_start')?.startsWith('lt.'));
                    return Response.json([{ site_id: 'expired-bucket' }]);
                }
                assert.equal(url.searchParams.get('event_type'), 'eq.pageview');
                assert.ok(url.searchParams.get('created_at')?.startsWith('lt.'));
                return Response.json([{ id: 'expired-pageview' }]);
            }
            assert.ok(url.pathname.endsWith('/attribution_conversions'));
            return Response.json([]);
        };
        for (const [name, route] of [['attribution-queries', queries], ['attribution-cleanup', cleanup]] as const) {
            assert.equal(route.GET, route.POST);
            const url = `https://app.test/api/cron/${name}`;
            for (const authorization of ['', 'Bearer wrong']) {
                assert.equal((await route.GET(new NextRequest(url, { headers: { authorization } }))).status, 401);
            }
            const count = calls.length;
            delete process.env.CRON_SECRET;
            assert.equal((await route.GET(new NextRequest(url, { headers: { authorization: 'Bearer test-cron-secret' } }))).status, 401);
            assert.equal(calls.length, count);
            process.env.CRON_SECRET = 'test-cron-secret';
            const response = await route.GET(new NextRequest(url, { headers: { authorization: 'Bearer test-cron-secret' } }));
            assert.equal(response.status, 200);
            const result = await response.json();
            if (name === 'attribution-cleanup') {
                assert.equal(result.deleted, 1);
                assert.equal(result.rateLimitBucketsDeleted, 1);
            }
            else assert.equal(result.total, 0);
        }
        assert.deepEqual(calls, [
            'GET /rest/v1/attribution_conversions',
            'DELETE /rest/v1/attribution_events',
            'DELETE /rest/v1/attribution_rate_limits',
        ]);
    } finally {
        globalThis.fetch = originalFetch;
        for (const key of ['CRON_SECRET', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
            if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
        }
    }
});
