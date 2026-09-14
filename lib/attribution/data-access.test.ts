import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    createAttributionSite, updateAttributionSite, verifyAttributionSite,
    getConversions, getEventCountsBySource, getLandingPagePerformance,
} from '../supabase/attribution.ts';
import { getConversionsMissingQueries, updateConversionQueries, matchQueries } from '../supabase/attribution-admin.ts';

const originalFetch = globalThis.fetch;
const env = { ...process.env };
const scope = { organizationId: 'org-a', clientId: 'client-a', siteId: 'site-a' };
const site = { id: scope.siteId, organization_id: scope.organizationId, client_id: scope.clientId, domain: 'example.com', is_active: true };
before(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://attribution-data-test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});
after(() => {
    globalThis.fetch = originalFetch;
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
        if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
});

function requireFilter(url: URL, key: string, value: string) {
    assert.equal(url.searchParams.get(key), `eq.${value}`, `Expected ${key} scoping on ${url.pathname}`);
}

function matchingFetch(options: { property?: string; denySite?: boolean; denyClient?: boolean; factsError?: boolean; facts?: unknown[] } = {}) {
    const property = options.property ?? 'sc-domain:example.com';
    const calls: URL[] = [];
    // 1,502 facts makes the monthly winner fall beyond the first PostgREST page.
    const facts = options.facts ?? [
        ...Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, page: 'https://example.com/service', query: 'daily query', clicks: 1, impressions: 10 })),
        ...Array.from({ length: 500 }, (_, index) => ({ id: index + 1001, page: 'https://example.com/service/', query: 'monthly winner', clicks: 3, impressions: 10 })),
        { id: 1501, page: 'https://other.com/service', query: 'foreign property row', clicks: 50000, impressions: 90000 },
        { id: 1502, page: 'https://shop.example.com/service', query: 'different hostname', clicks: 50000, impressions: 90000 },
    ];
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        calls.push(url);
        switch (url.pathname.split('/').pop()) {
            case 'attribution_sites':
                requireFilter(url, 'client_id', scope.clientId);
                requireFilter(url, 'organization_id', scope.organizationId);
                requireFilter(url, 'id', scope.siteId);
                return Response.json(options.denySite ? null : site);
            case 'clients':
                requireFilter(url, 'id', scope.clientId);
                requireFilter(url, 'organization_id', scope.organizationId);
                return Response.json(options.denyClient ? null : { id: scope.clientId });
            case 'client_integrations':
                requireFilter(url, 'client_id', scope.clientId);
                requireFilter(url, 'organization_id', scope.organizationId);
                requireFilter(url, 'service', 'gsc');
                assert.equal(url.searchParams.get('select'), 'property:credentials->>site_url');
                assert.equal(url.searchParams.get('sync_status'), 'in.(active,error)');
                return Response.json({ property });
            case 'gsc_history_days':
                requireFilter(url, 'organization_id', scope.organizationId);
                requireFilter(url, 'client_id', scope.clientId);
                requireFilter(url, 'property', property);
                requireFilter(url, 'search_type', 'web');
                assert.deepEqual(url.searchParams.getAll('data_date'), ['gte.2026-02-01', 'lt.2026-03-01']);
                return Response.json([{ id: 'day-a' }, { id: 'day-b' }]);
            case 'gsc_history_facts': {
                requireFilter(url, 'grain', 'query_page');
                assert.equal(url.searchParams.get('day_id'), 'in.(day-a,day-b)');
                assert.equal(url.searchParams.get('order'), 'id.asc');
                assert.equal(url.searchParams.get('limit'), '1000');
                if (options.factsError) return Response.json({ message: 'GSC facts unavailable' }, { status: 500 });
                const after = Number(url.searchParams.get('id')?.replace('gt.', '') ?? 0);
                return Response.json((facts as { id: number }[]).filter(fact => fact.id > after).slice(0, 1000));
            }
            default: assert.fail(`Unexpected request ${request.url}`);
        }
    };
    return calls;
}

test('matching pages through all monthly facts with exact org/property/site scoping before query aggregation', async () => {
    const calls = matchingFetch();
    const result = await matchQueries(scope.clientId, 'https://example.com/service', '2026-02', scope);
    assert.deepEqual(result, [
        { query: 'monthly winner', clicks: 1500, confidence: 0.6 },
        { query: 'daily query', clicks: 1000, confidence: 0.4 },
    ]);
    assert.deepEqual(calls.filter(url => url.pathname.endsWith('/gsc_history_facts')).map(url => url.searchParams.get('id')), [null, 'gt.1000', 'gt.1502']);
});

test('matching refuses a foreign site or client and never requests history for it', async () => {
    const missing = matchingFetch({ denySite: true });
    assert.deepEqual(await matchQueries(scope.clientId, '/service', '2026-02', scope), []);
    assert.equal(missing.length, 1);
    const foreign = matchingFetch({ denyClient: true });
    await assert.rejects(matchQueries(scope.clientId, '/service', '2026-02', scope), /organization mismatch/);
    assert.equal(foreign.length, 2);
});

test('property reassignment cannot mix previous websites, URL prefixes, or old-domain conversions', async () => {
    for (const [property, landingPage] of [
        ['sc-domain:other.com', 'https://example.com/service'],
        ['https://example.com/blog/', 'https://example.com/service'],
        ['sc-domain:example.com', 'https://previous.com/service'],
    ]) {
        const calls = matchingFetch({ property });
        assert.deepEqual(await matchQueries(scope.clientId, landingPage, '2026-02', scope), []);
        assert.equal(calls.some(url => url.pathname.endsWith('/gsc_history_days')), false);
    }
    matchingFetch({ property: 'https://example.com/service', facts: [
        { id: 1, page: 'https://example.com/service', query: 'current prefix only', clicks: 10, impressions: 20 },
        { id: 2, page: 'http://example.com/service', query: 'wrong protocol', clicks: 100, impressions: 200 },
    ] });
    assert.deepEqual(await matchQueries(scope.clientId, 'https://example.com/service', '2026-02', scope), [{ query: 'current prefix only', clicks: 10, confidence: 1 }]);
});

test('GSC read failures propagate instead of materializing misleading empty matches', async () => {
    matchingFetch({ factsError: true });
    await assert.rejects(matchQueries(scope.clientId, '/service', '2026-02', scope), { message: 'GSC facts unavailable' });
});

test('report helpers propagate database errors into the existing dashboard catch path', async () => {
    globalThis.fetch = async () => Response.json({ message: 'reporting unavailable' }, { status: 500 });
    for (const load of [getEventCountsBySource, getLandingPagePerformance]) {
        await assert.rejects(load(scope.clientId, '2026-09'), { message: 'reporting unavailable' });
    }
    const component = readFileSync('components/attribution/AttributionTab.tsx', 'utf8');
    assert.match(component, /catch\(reason => \{\s*if \(active\) setError/);
    assert.match(component, /const seoConversions = countSeoConversions\(sourceCounts\)/);
    assert.match(component, /<RoiCard conversions=\{seoConversions\}/);
    assert.match(component, /<SourceDonut data=\{sourceCounts\}/);
});

test('reporting and cron selection paginate all conversions and retain source/site/org fields', async () => {
    const rows = Array.from({ length: 1002 }, (_, index) => ({
        id: String(index + 1).padStart(5, '0'), organization_id: scope.organizationId,
        client_id: scope.clientId, site_id: scope.siteId, event_id: `event-${index}`,
        source_category: index < 1000 ? 'paid' : 'organic_google',
        landing_page: 'https://example.com/service', page_url: '/contact',
        likely_queries: [{ query: 'plumber' }], month: '2026-09-01', created_at: '2026-09-12T00:00:00Z',
    }));
    globalThis.fetch = async (input, init) => {
        const url = new URL(new Request(input, init).url);
        const after = url.searchParams.get('id')?.replace('gt.', '') ?? '';
        assert.equal(url.searchParams.get('order'), 'id.asc');
        if (url.searchParams.has('likely_queries')) {
            assert.match(url.searchParams.get('select') ?? '', /organization_id,site_id,client_id/);
            requireFilter(url, 'source_category', 'organic_google');
        } else {
            requireFilter(url, 'client_id', scope.clientId);
            requireFilter(url, 'month', '2026-09-01');
        }
        return Response.json(rows.filter(row => row.id > after)
            .filter(row => !url.searchParams.has('likely_queries') || row.source_category === 'organic_google')
            .slice(0, 1000));
    };
    assert.equal((await getConversions(scope.clientId, { month: '2026-09' })).length, 1002);
    assert.deepEqual(await getEventCountsBySource(scope.clientId, '2026-09'), [
        { sourceCategory: 'paid', count: 1000 }, { sourceCategory: 'organic_google', count: 2 },
    ]);
    assert.equal((await getLandingPagePerformance(scope.clientId, '2026-09'))[0].count, 1002);
    const pending = await getConversionsMissingQueries();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].organizationId, scope.organizationId);
    assert.equal(pending[0].siteId, scope.siteId);
});

test('cron query writes are scoped by conversion, client, site, and organization and skip already-filled queries', async () => {
    let calls = 0;
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        assert.equal(request.method, 'PATCH');
        requireFilter(url, 'id', 'conversion-a');
        requireFilter(url, 'organization_id', scope.organizationId);
        requireFilter(url, 'client_id', scope.clientId);
        requireFilter(url, 'site_id', scope.siteId);
        assert.equal(url.searchParams.get('likely_queries'), 'is.null');
        calls++;
        return new Response(null, { status: 204 });
    };
    await updateConversionQueries('conversion-a', [{ query: 'q', clicks: 1, confidence: 1 }], scope);
    assert.equal(calls, 1);
});

test('site create/update always canonicalize domains, and verification only reads real receipt state', async () => {
    const requests: Request[] = [];
    let verified = false;
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        assert.ok(new URL(request.url).pathname.endsWith('/attribution_sites'));
        return Response.json({ ...site, verified_at: verified ? '2026-09-12T00:00:00Z' : null });
    };
    await createAttributionSite({ organizationId: scope.organizationId, clientId: scope.clientId, domain: 'https://WWW.EXAMPLE.COM:8443/x?y=1' });
    assert.equal((await requests[0].json()).domain, 'example.com');
    await updateAttributionSite(scope.siteId, { domain: 'EXAMPLE.COM?x=y' });
    const update = await requests[1].json();
    assert.equal(update.domain, 'example.com');
    assert.equal('verified_at' in update, false);
    await assert.rejects(verifyAttributionSite(scope.siteId), /No tracking event received/);
    assert.equal(requests[2].method, 'GET');
    verified = true;
    assert.equal((await verifyAttributionSite(scope.siteId)).verifiedAt, '2026-09-12T00:00:00Z');
    assert.equal(requests[3].method, 'GET');
    const count = requests.length;
    await assert.rejects(createAttributionSite({ organizationId: scope.organizationId, clientId: scope.clientId, domain: 'invalid' }), /valid website domain/);
    await assert.rejects(updateAttributionSite(scope.siteId, { domain: 'bad_domain.com' }), /valid website domain/);
    assert.equal(requests.length, count);
    const component = readFileSync('components/attribution/AttributionSetup.tsx', 'utf8');
    assert.match(component, /const verified = Boolean\(site\?\.verifiedAt\)/);
    assert.doesNotMatch(component, /mode: 'no-cors'|verifiedAt: new Date/);
});
