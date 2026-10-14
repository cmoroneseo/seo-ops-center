import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBingStore } from './store.ts';
import { BING_PARK_SECONDS, BING_SYNC_FAILED_MESSAGE, BING_UNVERIFIED_MESSAGE } from './sync.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const KEY = 'synthetic-bing-key';
const NOW = new Date('2026-10-14T12:00:00.000Z');

function allowed(): NodeJS.ProcessEnv {
    return { BING_WEBMASTER: 'true', BING_WEBMASTER_ORG_IDS: ORG } as NodeJS.ProcessEnv;
}

interface Call {
    table?: string;
    op: string;
    columns?: string;
    values?: unknown;
    patch?: unknown;
    filters: unknown[];
    fn?: string;
    args?: Record<string, unknown>;
}

function fakeAdmin(respond: (call: Call) => { data: unknown; error: { code?: string; message?: string } | null }) {
    const calls: Call[] = [];
    const admin = {
        calls,
        async rpc(fn: string, args: Record<string, unknown>) {
            const call: Call = { op: 'rpc', fn, args, filters: [] };
            calls.push(call);
            return respond(call);
        },
        from(table: string) {
            const call: Call = { table, op: 'select', filters: [] };
            const self = {
                select(columns: string) {
                    call.columns = columns;
                    return self;
                },
                insert(values: unknown) {
                    call.op = 'insert';
                    call.values = values;
                    calls.push(call);
                    return Promise.resolve(respond(call));
                },
                update(patch: unknown) {
                    call.op = 'update';
                    call.patch = patch;
                    return self;
                },
                eq(column: string, value: unknown) {
                    call.filters.push(['eq', column, value]);
                    return self;
                },
                in(column: string, value: unknown) {
                    call.filters.push(['in', column, value]);
                    return self;
                },
                order() { return self; },
                range() {
                    calls.push(call);
                    return Promise.resolve(respond(call));
                },
                then(onFulfilled: (value: { data: unknown; error: { code?: string; message?: string } | null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                    calls.push(call);
                    return Promise.resolve(respond(call)).then(onFulfilled, onRejected);
                },
            };
            return self;
        },
    };
    return admin;
}

const ok = { data: [], error: null };

test('storage refuses an org that is not allowlisted before querying', async () => {
    let called = false;
    const admin = {
        rpc() { called = true; return Promise.reject(new Error('called')); },
        from() { called = true; return {}; },
    };
    const store = createBingStore(admin as unknown as SupabaseClient, allowed(), () => NOW);
    await assert.rejects(() => store.listClients(OTHER), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Bing sync storage failed');
        return true;
    });
    assert.equal(called, false);
});

test('reads project the site URL only, and a driver error does not keep its message', async () => {
    const admin = fakeAdmin(call => {
        if (call.op === 'rpc') return { data: null, error: { code: 'XX000', message: `driver ${KEY}` } };
        if (call.table === 'clients') {
            return { data: [{ id: 'c1', organization_id: ORG, domain: 'example.test', status: 'active' }], error: null };
        }
        return {
            data: [{ id: 'i1', client_id: 'c1', organization_id: ORG, sync_status: 'active', site_url: 'https://example.test/' }],
            error: null,
        };
    });
    const store = createBingStore(admin as unknown as SupabaseClient, allowed(), () => NOW);
    assert.deepEqual(await store.listClients(ORG), [{
        id: 'c1', organizationId: ORG, domain: 'example.test', status: 'active', gscSiteUrl: 'https://example.test/',
    }]);
    assert.deepEqual(await store.listIntegrations(ORG), [{
        clientId: 'c1', organizationId: ORG, syncStatus: 'active', siteUrl: 'https://example.test/',
    }]);
    assert.equal(admin.calls[0]?.columns, 'id, organization_id, domain, status');
    assert.equal(admin.calls[1]?.columns, 'client_id, site_url:credentials->>site_url');
    assert.equal(admin.calls[1]?.columns?.split('token').length, 1);
    assert.equal(admin.calls[1]?.table, 'client_integrations');
    assert.deepEqual(admin.calls[1]?.filters, [
        ['eq', 'organization_id', ORG],
        ['eq', 'service', 'gsc'],
    ]);
    assert.equal(admin.calls[2]?.columns, 'id, client_id, organization_id, sync_status, site_url:credentials->>site_url');
    await assert.rejects(() => store.enqueue(ORG, 'c1'), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Bing sync storage failed');
        return true;
    });
});

test('sync ranks read the site clock and completeness, not credentials', async () => {
    const admin = fakeAdmin(call => {
        if (call.table === 'client_integrations') {
            return { data: [{ client_id: 'c1', last_synced_at: '2026-10-14T12:00:00.000Z' }], error: null };
        }
        return { data: [{ client_id: 'c1', queries_complete: false, pages_complete: true }], error: null };
    });
    const store = createBingStore(admin as unknown as SupabaseClient, allowed(), () => NOW);
    assert.deepEqual(await store.listSyncRanks(ORG), [{
        clientId: 'c1', lastSyncedAt: '2026-10-14T12:00:00.000Z', complete: false,
    }]);
    assert.equal(admin.calls[0]?.columns, 'client_id, last_synced_at');
    assert.equal(admin.calls[0]?.columns?.split('token').length, 1);
    assert.deepEqual(admin.calls[0]?.filters, [
        ['eq', 'organization_id', ORG],
        ['eq', 'service', 'bing'],
    ]);
    assert.equal(admin.calls[1]?.table, 'bing_traffic_days');
    assert.equal(admin.calls[1]?.columns, 'client_id, queries_complete, pages_complete');
});

test('inserts, claims, and snapshot replacement use the migration 094 contracts', async () => {
    const admin = fakeAdmin(call => {
        if (call.op === 'insert') return { data: null, error: { code: '23505', message: KEY } };
        if (call.fn === 'enqueue_bing_sync') return { data: true, error: null };
        if (call.fn === 'claim_bing_sync') {
            return {
                data: [{
                    id: 'job-1', organization_id: ORG, client_id: 'c1', site_url: 'https://example.test/blog',
                    lease_token: 'lease-1', attempts: 2,
                }],
                error: null,
            };
        }
        if (call.fn === 'replace_bing_snapshot') return { data: false, error: null };
        if (call.op === 'update') return { data: [{ id: 'job-1' }], error: null };
        return ok;
    });
    const store = createBingStore(admin as unknown as SupabaseClient, allowed(), () => NOW);
    assert.equal(await store.insertMapping({
        organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/blog',
    }), false);
    assert.deepEqual(admin.calls[0]?.values, {
        organization_id: ORG,
        client_id: 'c1',
        service: 'bing',
        credentials: { site_url: 'https://example.test/blog' },
        sync_status: 'active',
        error_message: null,
    });
    const fresh = fakeAdmin(() => ({ data: null, error: null }));
    const inserted = createBingStore(fresh as unknown as SupabaseClient, allowed(), () => NOW);
    assert.equal(await inserted.insertMapping({
        organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/blog',
    }), true);

    assert.equal(await store.enqueue(ORG, 'c1'), true);
    assert.deepEqual(admin.calls.find(call => call.fn === 'enqueue_bing_sync')?.args, {
        p_organization_id: ORG,
        p_client_id: 'c1',
    });
    assert.deepEqual(await store.claim(), {
        id: 'job-1', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/blog',
        leaseToken: 'lease-1', attempts: 2,
    });
    assert.equal(await store.replace({
        organizationId: ORG,
        clientId: 'c1',
        siteUrl: 'https://example.test/blog',
        fetchedAt: NOW.toISOString(),
        traffic: [{ data_date: '2011-09-16', clicks: 1, impressions: 2 }],
        queries: null,
        pages: null,
    }), false);
    const replaced = admin.calls.find(call => call.fn === 'replace_bing_snapshot');
    assert.equal(replaced?.args?.p_queries, null);
    assert.equal(replaced?.args?.p_pages, null);
    assert.deepEqual(replaced?.args?.p_traffic, [{ data_date: '2011-09-16', clicks: 1, impressions: 2 }]);

    await store.markUnverified({ organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/blog' });
    const unverified = admin.calls.filter(call => call.op === 'update');
    assert.deepEqual(unverified[0]?.patch, { sync_status: 'error', error_message: BING_UNVERIFIED_MESSAGE });
    assert.deepEqual(unverified[1]?.patch, {
        status: 'idle',
        available_at: new Date(NOW.getTime() + BING_PARK_SECONDS * 1000).toISOString(),
        lease_token: null,
        lease_until: null,
        updated_at: NOW.toISOString(),
    });
    await store.release({
        id: 'job-1', leaseToken: 'lease-1', status: 'idle', availableAt: NOW.toISOString(), resetAttempts: true,
    });
    const released = admin.calls.filter(call => call.op === 'update').at(-1);
    assert.equal((released?.patch as { attempts?: number }).attempts, 0);
    await store.markFailed({
        id: 'job-1', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/blog',
        leaseToken: 'lease-1', attempts: 1,
    }, BING_SYNC_FAILED_MESSAGE);
    const failed = admin.calls.filter(call => call.op === 'update').at(-1);
    assert.deepEqual(failed?.patch, { sync_status: 'error', error_message: BING_SYNC_FAILED_MESSAGE });
});
