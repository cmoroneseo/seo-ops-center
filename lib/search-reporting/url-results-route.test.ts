import test from 'node:test';
import assert from 'node:assert/strict';
import { createUrlResultsHandler } from './url-results-route';
import { loadUrlResults } from './url-results-load';
import type { UrlResultsLoadInput } from './url-results-load';
import type { SearchReportingAdmin } from './load';

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';

function handler(options: { fail?: boolean } = {}) {
    const calls: { load?: UrlResultsLoadInput } = {};
    const api = createUrlResultsHandler({
        authorize: async (clientId) => clientId === client
            ? { ok: true, organizationId: org, clientId: client }
            : { ok: false, status: 403, error: 'Forbidden' },
        load: async (input) => {
            calls.load = input;
            if (options.fail) throw new Error('secret token from postgres');
            return { connected: false, byId: {} };
        },
        now: () => new Date('2026-10-10T18:00:00.000Z'),
    });
    return { api, calls };
}

test('a cross-org client is forbidden before URL results are read', async () => {
    const { api, calls } = handler();
    const response = await api(new Request(`https://app.test/api/search-reporting/url-results?clientId=${foreign}`));
    assert.equal(response.status, 403);
    assert.equal(calls.load, undefined);
});

test('URL results use the membership organization', async () => {
    const { api, calls } = handler();
    const response = await api(new Request(`https://app.test/api/search-reporting/url-results?clientId=${client}&orgId=99999999-9999-4999-8999-999999999999`));
    assert.equal(response.status, 200);
    assert.equal(calls.load?.organizationId, org);
    assert.equal(calls.load?.clientId, client);
    const body = await response.json() as { connected: boolean };
    assert.equal(body.connected, false);
    assert.equal(JSON.stringify(body).includes('99999999'), false);
});

test('a read failure does not echo the upstream message', async () => {
    const { api } = handler({ fail: true });
    const response = await api(new Request(`https://app.test/api/search-reporting/url-results?clientId=${client}`));
    assert.equal(response.status, 500);
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'Unable to read URL results');
    assert.equal(JSON.stringify(body).includes('secret'), false);
});

test('a connected client with no stored rows is not indexed, and no property shows nothing', async () => {
    const filters: { table: string; column: string; value: unknown }[] = [];
    function adminFor(property: string | null): SearchReportingAdmin {
        return {
            from(table: string) {
                const api = {
                    select() { return api; },
                    eq(column: string, value: unknown) { filters.push({ table, column, value }); return api; },
                    gte() { return api; },
                    lte() { return api; },
                    in() { return api; },
                    order() { return api; },
                    async range() {
                        if (table === 'tasks') {
                            return {
                                data: [{
                                    id: 'piece',
                                    published_url: 'https://www.example.com/chino/',
                                    completed_at: '2026-10-08T20:00:00.000Z',
                                    status: 'done',
                                }],
                                error: null,
                            };
                        }
                        if (table === 'gsc_live_url_checks' && property) {
                            return {
                                data: [{
                                    url_key: 'example.com/chino',
                                    coverage_start: '2026-10-05',
                                    query_window_start: '2026-10-08',
                                    query_window_end: '2026-10-10',
                                    has_rows: false,
                                }],
                                error: null,
                            };
                        }
                        return { data: [], error: null };
                    },
                    async maybeSingle() {
                        if (table === 'client_integrations') {
                            return { data: property ? { site_url: property } : null, error: null };
                        }
                        return { data: null, error: null };
                    },
                };
                return api;
            },
        };
    }

    const disconnected = await loadUrlResults({
        organizationId: org,
        clientId: client,
        now: new Date('2026-10-10T18:00:00.000Z'),
    }, adminFor(null));
    assert.deepEqual(disconnected, { connected: false, byId: {} });

    const connected = await loadUrlResults({
        organizationId: org,
        clientId: client,
        now: new Date('2026-10-10T18:00:00.000Z'),
    }, adminFor('sc-domain:example.com'));
    assert.equal(connected.connected, true);
    assert.equal(connected.byId.piece?.kind, 'not_indexed');
    assert.equal(filters.some(filter => filter.table === 'tasks' && filter.column === 'organization_id' && filter.value === org), true);
    assert.equal(filters.some(filter => filter.column === 'property' && filter.value === 'sc-domain:example.com'), true);
});
