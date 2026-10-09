import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSearchReporting, type SearchReportingAdmin } from './load';

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';

test('history reads are scoped to the member organization and the selected property', async () => {
    const filters: { table: string; column: string; value: unknown }[] = [];
    const selected: string[] = [];
    const ins: { table: string; column: string; values: readonly unknown[] }[] = [];
    const admin: SearchReportingAdmin = {
        from(table: string) {
            const api = {
                select(columns: string) { selected.push(`${table}:${columns}`); return api; },
                eq(column: string, value: unknown) { filters.push({ table, column, value }); return api; },
                gte() { return api; },
                lte() { return api; },
                in(column: string, values: readonly unknown[]) { ins.push({ table, column, values }); return api; },
                order() { return api; },
                async range() {
                    if (table === 'gsc_history_days') {
                        return { data: [{ id: 'day-1', data_date: '2026-09-15', imported_at: '2026-10-01T00:00:00Z', is_incomplete: false, page_limited: false, query_limited: false }], error: null };
                    }
                    return { data: [], error: null };
                },
                async maybeSingle() {
                    if (table === 'clients') return { data: { name: 'Scott Cole', custom_fields: { service_cities: ['Eastvale', 'Corona'] } }, error: null };
                    if (table === 'client_integrations') return { data: { site_url: 'sc-domain:example.com', sync_status: 'active', last_synced_at: '2026-10-08T00:00:00Z' }, error: null };
                    if (table === 'metrics') return { data: { data: { domain_rating: 12, ranked_keywords: 4 }, updated_at: '2026-10-01T00:00:00Z' }, error: null };
                    return { data: null, error: null };
                },
            };
            return api;
        },
    };
    const loaded = await loadSearchReporting({
        organizationId: org,
        clientId: client,
        range: '2026-09',
        now: new Date('2026-10-09T18:00:00.000Z'),
        cityTokens: ['Riverside'],
    }, admin);
    assert.equal(loaded.connected, true);
    assert.equal(loaded.property, 'sc-domain:example.com');
    assert.deepEqual(loaded.cityTokens, ['Eastvale', 'Corona', 'Riverside']);
    assert.deepEqual(loaded.ahrefsRows, []);
    assert.equal(filters.find(filter => filter.table === 'clients' && filter.column === 'id')?.value, client);
    assert.equal(filters.find(filter => filter.table === 'clients' && filter.column === 'organization_id')?.value, org);
    for (const table of ['client_integrations', 'gsc_history_days', 'metrics']) {
        assert.equal(filters.find(filter => filter.table === table && filter.column === 'organization_id')?.value, org);
        assert.equal(filters.find(filter => filter.table === table && filter.column === 'client_id')?.value, client);
    }
    assert.equal(filters.some(filter => filter.table === 'gsc_history_days' && filter.column === 'property' && filter.value === 'sc-domain:example.com'), true);
    assert.equal(selected.some(item => item.startsWith('client_integrations:') && item.includes('site_url:credentials->>site_url')), true);
    assert.equal(selected.some(item => item === 'client_integrations:credentials'), false);
    assert.deepEqual(ins.find(item => item.table === 'gsc_history_facts' && item.column === 'day_id')?.values, ['day-1']);
    const grainFilters = ins.filter(item => item.table === 'gsc_history_facts' && item.column === 'grain');
    assert.equal(grainFilters.length > 0, true);
    assert.equal(grainFilters.every(item => item.values.length === 1), true);
    assert.equal(grainFilters.some(item => item.values[0] === 'query_page'), true);
    assert.equal(grainFilters.some(item => item.values[0] === 'property'), true);
    assert.equal(grainFilters.some(item => item.values.includes('property_country')), false);
    assert.equal(loaded.unavailableGrains.length, 0);
});
