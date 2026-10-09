import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLedger } from './ledger-load';
import type { SearchReportingAdmin } from './load';

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';

test('ledger reads stay on page facts for the member organization', async () => {
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
                    if (table === 'deliverables') {
                        return {
                            data: [{
                                id: 'del-1',
                                title: 'Chino page',
                                type: 'Content',
                                subtype: 'city_page',
                                status: 'Published',
                                published_url: 'https://example.com/chino',
                                delivered_on: '2026-08-06',
                            }],
                            error: null,
                        };
                    }
                    if (table === 'gsc_history_days') {
                        return { data: [{ id: 'day-1', data_date: '2026-08-06', is_incomplete: false }], error: null };
                    }
                    if (table === 'gsc_history_facts') {
                        return {
                            data: [
                                { day_id: 'day-1', grain: 'page', page: 'https://example.com/chino', clicks: 1, impressions: 2, position: 3, surface: 'organic' },
                                { day_id: 'day-1', grain: 'page', page: 'https://example.com/chino', clicks: 1, impressions: 2, position: 3, surface: null },
                            ],
                            error: null,
                        };
                    }
                    return { data: [], error: null };
                },
                async maybeSingle() {
                    if (table === 'clients') return { data: { domain: 'example.com' }, error: null };
                    if (table === 'client_integrations') {
                        return { data: { site_url: 'sc-domain:example.com', sync_status: 'active', last_synced_at: '2026-10-09T16:00:00.000Z' }, error: null };
                    }
                    return { data: null, error: null };
                },
            };
            return api;
        },
    };

    const loaded = await loadLedger({
        organizationId: org,
        clientId: client,
        now: new Date('2026-10-09T18:00:00.000Z'),
    }, admin);

    assert.equal(loaded.connected, true);
    assert.equal(loaded.clientDomain, 'example.com');
    assert.equal(loaded.facts.length, 1);
    assert.equal(loaded.facts[0].grain, 'page');
    assert.equal(loaded.unsurfacedRows, 1);
    assert.equal(loaded.deliverables[0].title, 'Chino page');
    for (const table of ['clients', 'client_integrations', 'deliverables', 'gsc_history_days']) {
        assert.equal(filters.find(filter => filter.table === table && filter.column === 'organization_id')?.value, org);
        assert.equal(filters.find(filter => filter.table === table && filter.column === 'client_id' || (table === 'clients' && filter.column === 'id'))?.value, client);
    }
    assert.equal(filters.find(filter => filter.table === 'clients' && filter.column === 'organization_id')?.value, org);
    assert.equal(selected.some(item => item === 'client_integrations:credentials'), false);
    assert.equal(selected.some(item => item.startsWith('client_integrations:') && item.includes('credentials->>site_url')), true);
    assert.deepEqual(ins.find(item => item.table === 'gsc_history_facts' && item.column === 'grain')?.values, ['page']);
    assert.equal(ins.some(item => item.values.includes('page_device') || item.values.includes('page_organic')), false);
});
