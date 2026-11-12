import test from 'node:test';
import assert from 'node:assert/strict';

import {
    aggregateQueryPageFacts,
    aggregateQueryPagePairs,
    loadArchitectGscQueries,
    loadArchitectPagePerformance,
} from './architect-gsc.ts';
import type { SearchReportingAdmin } from '../search-reporting/load.ts';

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';

const fixtureFacts = [
    { query: 'plumber near me', page: 'https://example.com/a', clicks: 4, impressions: 10, position: 2 },
    { query: 'plumber near me', page: 'https://example.com/a', clicks: 1, impressions: 10, position: 4 },
    { query: 'plumber near me', page: 'https://example.com/b', clicks: 0, impressions: 30, position: 10 },
    { query: 'drain cleaning', page: 'https://example.com/c', clicks: 2, impressions: 8, position: 6 },
    { query: '   ', page: 'https://example.com/skip', clicks: 99, impressions: 99, position: 1 },
];

test('query_page rows roll up by query and keep the strongest page', () => {
    const queries = aggregateQueryPageFacts(fixtureFacts);
    assert.deepEqual(queries.map(query => query.query), ['plumber near me', 'drain cleaning']);
    const plumber = queries[0];
    assert.equal(plumber?.clicks, 5);
    assert.equal(plumber?.impressions, 50);
    assert.ok(plumber && Math.abs(plumber.position - 7.2) < 1e-9);
    assert.equal(plumber?.page, 'https://example.com/b');
    assert.equal(queries[1]?.page, 'https://example.com/c');
});

test('aggregation keeps the 50 queries with the most clicks', () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
        query: `query ${index}`,
        page: '/p',
        clicks: index,
        impressions: 1,
        position: 3,
    }));
    const queries = aggregateQueryPageFacts(rows);
    assert.equal(queries.length, 50);
    assert.equal(queries[0]?.query, 'query 59');
    assert.equal(queries.at(-1)?.query, 'query 10');
});

interface FixtureOptions {
    integration?: unknown;
    integrationError?: { message: string } | null;
    days?: unknown[] | null;
    daysError?: { message: string } | null;
    facts?: unknown[] | null;
    factsError?: { message: string } | null;
}

function fixtureAdmin(options: FixtureOptions) {
    const tables: string[] = [];
    const filters: { table: string; column: string; value: unknown }[] = [];
    const ins: { table: string; column: string; values: readonly unknown[] }[] = [];
    const ranges: { table: string; from: number; to: number }[] = [];
    const admin: SearchReportingAdmin = {
        from(table: string) {
            tables.push(table);
            const api = {
                select() { return api; },
                eq(column: string, value: unknown) { filters.push({ table, column, value }); return api; },
                gte() { return api; },
                lte() { return api; },
                in(column: string, values: readonly unknown[]) { ins.push({ table, column, values }); return api; },
                order() { return api; },
                async range(from: number, to: number) {
                    ranges.push({ table, from, to });
                    if (table === 'gsc_history_days') return { data: options.days ?? [], error: options.daysError ?? null };
                    if (table === 'gsc_history_facts') return { data: options.facts ?? [], error: options.factsError ?? null };
                    return { data: [], error: null };
                },
                async maybeSingle() {
                    if (table === 'client_integrations') {
                        return { data: options.integration ?? null, error: options.integrationError ?? null };
                    }
                    return { data: null, error: null };
                },
            };
            return api;
        },
    };
    return { admin, tables, filters, ins, ranges };
}

test('the architect read loads query_page rows from gsc_history_facts', async () => {
    const { admin, tables, filters, ins } = fixtureAdmin({
        integration: { site_url: 'sc-domain:example.com' },
        days: [{ id: 'day-1' }, { id: 'day-2' }],
        facts: fixtureFacts,
    });
    const queries = await loadArchitectGscQueries(admin, { organizationId: org, clientId: client });
    assert.equal(tables.includes('gsc_search_performance'), false);
    assert.equal(tables.includes('gsc_history_days'), true);
    assert.equal(tables.includes('gsc_history_facts'), true);
    assert.equal(filters.find(filter => filter.table === 'gsc_history_days' && filter.column === 'organization_id')?.value, org);
    assert.equal(filters.find(filter => filter.table === 'gsc_history_days' && filter.column === 'client_id')?.value, client);
    assert.equal(filters.find(filter => filter.table === 'gsc_history_days' && filter.column === 'property')?.value, 'sc-domain:example.com');
    assert.equal(filters.find(filter => filter.table === 'gsc_history_days' && filter.column === 'search_type')?.value, 'web');
    assert.deepEqual(ins.find(item => item.table === 'gsc_history_facts' && item.column === 'day_id')?.values, ['day-1', 'day-2']);
    const grains = ins.filter(item => item.table === 'gsc_history_facts' && item.column === 'grain');
    assert.equal(grains.length > 0, true);
    assert.equal(grains.every(item => item.values.length === 1 && item.values[0] === 'query_page'), true);
    assert.equal(queries[0]?.query, 'plumber near me');
    assert.equal(queries[0]?.clicks, 5);
    assert.equal(queries[1]?.query, 'drain cleaning');
});

test('a client without a Search Console property does not read history facts', async () => {
    const { admin, tables } = fixtureAdmin({ integration: { site_url: '  ' }, days: [{ id: 'day-1' }], facts: fixtureFacts });
    const queries = await loadArchitectGscQueries(admin, { organizationId: org, clientId: client });
    assert.deepEqual(queries, []);
    assert.equal(tables.includes('gsc_history_facts'), false);
    assert.equal(tables.includes('gsc_search_performance'), false);
});

test('a failed history read returns no queries', async () => {
    const missingDays = fixtureAdmin({
        integration: { site_url: 'sc-domain:example.com' },
        daysError: { message: 'unavailable' },
        facts: fixtureFacts,
    });
    assert.deepEqual(await loadArchitectGscQueries(missingDays.admin, { organizationId: org, clientId: client }), []);
    assert.equal(missingDays.tables.includes('gsc_history_facts'), false);

    const failedFacts = fixtureAdmin({
        integration: { site_url: 'sc-domain:example.com' },
        days: [{ id: 'day-1' }],
        factsError: { message: 'canceling statement due to statement timeout' },
    });
    assert.deepEqual(await loadArchitectGscQueries(failedFacts.admin, { organizationId: org, clientId: client }), []);
    assert.equal(JSON.stringify(await loadArchitectGscQueries(failedFacts.admin, { organizationId: org, clientId: client })).includes('statement timeout'), false);
});

test('every search and page pair is kept, not just the top 50 searches', () => {
    const pairs = aggregateQueryPagePairs(fixtureFacts);
    const plumberA = pairs.find(pair => pair.query === 'plumber near me' && pair.page === 'https://example.com/a');
    assert.equal(pairs.length, 3);
    assert.equal(plumberA?.impressions, 20);
    assert.equal(plumberA?.position, 3);
});

test('the page performance read uses the page grain over at most 180 stored days', async () => {
    const { admin, ins, ranges } = fixtureAdmin({
        integration: { site_url: 'sc-domain:example.com' },
        days: [{ id: 'day-1', data_date: '2026-11-01' }, { id: 'day-2', data_date: '2026-07-01' }],
        facts: [
            { day_id: 'day-1', page: 'https://example.com/a', clicks: 1, impressions: 10, position: 5 },
            { day_id: 'day-2', page: 'https://example.com/a', clicks: 4, impressions: 40, position: 5 },
        ],
    });
    const read = await loadArchitectPagePerformance(admin, { organizationId: org, clientId: client });
    assert.deepEqual(ranges.filter(r => r.table === 'gsc_history_days').map(r => [r.from, r.to]), [[0, 179]]);
    const grains = ins.filter(item => item.table === 'gsc_history_facts' && item.column === 'grain');
    assert.equal(grains.length > 0, true);
    assert.equal(grains.every(item => item.values.length === 1 && item.values[0] === 'page'), true);
    assert.equal(read.recentDays, 1);
    assert.equal(read.priorDays, 1);
    assert.deepEqual(read.pages.get('example.com/a')?.recent, { clicks: 1, impressions: 10, position: 5 });
    assert.deepEqual(read.pages.get('example.com/a')?.prior, { clicks: 4, impressions: 40, position: 5 });
});

test('a failed page performance read gives no signals', async () => {
    const { admin } = fixtureAdmin({
        integration: { site_url: 'sc-domain:example.com' },
        days: [{ id: 'day-1', data_date: '2026-11-01' }],
        factsError: { message: 'canceling statement due to statement timeout' },
    });
    const read = await loadArchitectPagePerformance(admin, { organizationId: org, clientId: client });
    assert.equal(read.pages.size, 0);
    assert.equal(read.recentDays, 0);
});
