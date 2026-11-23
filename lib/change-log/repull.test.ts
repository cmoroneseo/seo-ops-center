import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { runSeoTestRepull } from '../../scripts/seo-test-data-repull';
import { Ga4AuthError } from '../ga4/run';
import type { GscGrain } from '../gsc/history';

const now = new Date('2026-11-23T02:00:00Z');
const ecoworkz = 'ab3ea11c-1111-4111-8111-111111111111';
const other = 'b0000000-2222-4222-8222-222222222222';
const excluded = 'c0000000-3333-4333-8333-333333333333';
const gscRange = { start: '2026-10-23', end: '2026-11-21' };
const ga4Range = { start: '2026-10-24', end: '2026-11-22' };

function connection(id: string, clientId: string, service: 'gsc' | 'ga4', sync_status = 'active') {
    return {
        id, client_id: clientId, organization_id: 'org', service, sync_status,
        clients: { name: clientId === ecoworkz ? 'Ecoworkz' : 'Other client' },
        site_url: `sc-domain:${id}.example`, property_id: 'properties/123',
    };
}

function coverage(row: ReturnType<typeof connection>, data_date: string, grains: GscGrain[]) {
    return {
        data_date, grains, organization_id: row.organization_id, client_id: row.client_id,
        property: row.site_url, search_type: 'web',
    };
}

type Deps = NonNullable<Parameters<typeof runSeoTestRepull>[2]>;

function fakeRepull({
    connections = [], days = [], maxRows = 500, gscV2,
    repullGsc = async () => assert.fail('Unexpected GSC write'),
    repullGa4 = async () => assert.fail('Unexpected GA4 write'),
}: {
    connections?: ReturnType<typeof connection>[];
    days?: ReturnType<typeof coverage>[];
    maxRows?: number;
    gscV2?: string;
    repullGsc?: Deps['repullGsc'];
    repullGa4?: Deps['repullGa4'];
} = {}) {
    const messages: string[] = [];
    const reads: URLSearchParams[] = [];
    let configChecks = 0;
    const db = createClient('https://repull.example', 'fake-key', {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: async (input, init) => {
            assert.equal(init?.method, 'GET');
            const url = new URL(String(input));
            const params = url.searchParams;
            reads.push(params);
            const offset = Number(params.get('offset'));
            const limit = Math.min(maxRows, Number(params.get('limit')));
            if (url.pathname.endsWith('/client_integrations')) {
                assert.equal(params.get('order'), 'id.asc');
                const matches = (column: string, value: string) => params.get(column)?.slice(4, -1).split(',').includes(value);
                const listed = connections.filter(row => matches('service', row.service) && matches('sync_status', row.sync_status)
                    && (!params.has('client_id') || matches('client_id', row.client_id)));
                return Response.json(listed.slice(offset, offset + limit));
            }
            assert.ok(url.pathname.endsWith('/gsc_history_days'));
            assert.equal(params.get('order'), 'data_date.asc');
            const listed = days.filter(day => params.get('organization_id') === `eq.${day.organization_id}`
                && params.get('client_id') === `eq.${day.client_id}` && params.get('property') === `eq.${day.property}`
                && params.get('search_type') === `eq.${day.search_type}` && day.data_date >= gscRange.start && day.data_date <= gscRange.end);
            assert.deepEqual(params.getAll('data_date'), [`gte.${gscRange.start}`, `lte.${gscRange.end}`]);
            const grains = ['property', 'page', 'query_page', 'property_device', 'page_device', 'property_country', 'page_organic'] as const;
            for (const grain of grains) {
                assert.match(params.get('select') ?? '', new RegExp(`${grain}:gsc_history_facts\\(grain\\)`));
                assert.equal(params.get(`${grain}.grain`), `eq.${grain}`);
                assert.equal(params.get(`${grain}.limit`), '1');
            }
            return Response.json(listed.slice(offset, offset + limit).map(day => Object.fromEntries(
                grains.map(grain => [grain, day.grains.includes(grain) ? [{ grain }] : []]),
            )));
        } },
    });
    const deps = { db, gscV2, checkGoogleConfig: () => { configChecks += 1; }, repullGsc, repullGa4 };
    return {
        run: (args: string[]) => runSeoTestRepull(args, now, deps, message => messages.push(message)),
        messages, reads, configChecks: () => configChecks,
    };
}

test('default dry run lists matching connections, windows and GSC grain counts using only capped SELECTs', async () => {
    const gsc = connection('conn-1', ecoworkz, 'gsc');
    const ga4 = connection('conn-2', ecoworkz, 'ga4', 'error');
    const fake = fakeRepull({
        connections: [gsc, ga4, connection('conn-3', ecoworkz, 'gsc', 'disconnected')], maxRows: 1,
        days: [coverage(gsc, '2026-11-10', ['property', 'page', 'page_organic']), coverage(gsc, '2026-11-11', [])],
    });
    await fake.run([]);
    const output = fake.messages.join('\n');
    assert.match(output, /Dry run/);
    assert.match(output, /GSC "Ecoworkz".*conn-1 2026-10-23 to 2026-11-21/);
    assert.match(output, /stored GSC grains property, page, page_organic \(0 v1-only, 1 v2, 1 empty days\)/);
    assert.match(output, /GA4 "Ecoworkz".*conn-2 2026-10-24 to 2026-11-22/);
    assert.doesNotMatch(output, /conn-3/);
    assert.equal(fake.configChecks(), 0);
    for (const order of ['id.asc', 'data_date.asc']) {
        assert.deepEqual(fake.reads.filter(params => params.get('order') === order).map(params => params.get('offset')), ['0', '1', '2']);
    }
});

test('client filters are repeatable and combine with the service filter and explicit write mode', async () => {
    const calls: unknown[] = [];
    const fake = fakeRepull({
        connections: [connection('conn-1', ecoworkz, 'ga4'), connection('conn-2', other, 'ga4'),
            connection('conn-3', ecoworkz, 'gsc'), connection('conn-4', excluded, 'ga4')],
        repullGa4: async (scope, range) => { calls.push([scope.clientId, range]); },
    });
    await fake.run(['--client', ecoworkz.toUpperCase(), '--write', '--service', 'ga4', '--client', other]);
    assert.deepEqual(calls, [[ecoworkz, ga4Range], [other, ga4Range]]);
    assert.equal(fake.configChecks(), 1);
    assert.ok(fake.reads.every(params => params.get('client_id') === `in.(${ecoworkz},${other})` && params.get('service') === 'in.(ga4)'));
});

test('invalid arguments fail before any reads or write configuration checks', async () => {
    const fake = fakeRepull();
    for (const args of [['--write=false'], ['--write', '--write'], ['--client'], ['--client', 'bad'],
        ['--service', 'gbp'], ['--service', 'gsc', '--service', 'ga4']]) {
        await assert.rejects(fake.run(args), /--client|--service/);
    }
    assert.equal(fake.reads.length, 0);
    assert.equal(fake.configChecks(), 0);
});

test('an opposite GSC grain set on any in-window day refuses that connection before pulling', async () => {
    const mixed = connection('conn-1', ecoworkz, 'gsc');
    const matching = connection('conn-2', other, 'gsc');
    for (const flag of ['false', 'true']) {
        const calls: unknown[] = [];
        const matchedGrain: GscGrain = flag === 'true' ? 'page_organic' : 'page';
        const mismatchedGrain: GscGrain = flag === 'true' ? 'page' : 'page_organic';
        const fake = fakeRepull({
            connections: [mixed, matching], maxRows: 1, gscV2: flag,
            days: [coverage(mixed, '2026-11-10', ['property', 'page']), coverage(mixed, '2026-11-11', ['property', 'property_device']),
                coverage(matching, '2026-11-11', [matchedGrain]), coverage(matching, '2026-11-12', []),
                coverage(matching, '2026-11-22', [mismatchedGrain])],
            repullGsc: async (scope, range) => { calls.push([scope.clientId, range]); },
        });
        await assert.rejects(fake.run(['--write', '--service', 'gsc']), /1 connection\(s\) failed/);
        assert.deepEqual(calls, [[other, gscRange]]);
        assert.match(fake.messages.join('\n'), new RegExp(`conn-1 re-pull failed .*GSC_HISTORY_V2_ENABLED=${flag} conflicts with 1 stored ${flag === 'true' ? 'v1-only' : 'v2'} day`));
    }
});

test('failure reasons identify the connection and omit raw messages and credentials', async () => {
    const fake = fakeRepull({
        connections: [connection('conn-1', ecoworkz, 'gsc'), connection('conn-2', other, 'ga4'), connection('conn-3', excluded, 'ga4')],
        gscV2: 'false',
        repullGsc: async () => { throw new Error('GSC history request failed (HTTP 429, quota)'); },
        repullGa4: async scope => {
            if (scope.clientId === other) throw new Ga4AuthError('access_token=secret-value', 'reauth_required');
            throw new TypeError('refresh_token=secret-value');
        },
    });
    await assert.rejects(fake.run(['--write']), /3 connection\(s\) failed/);
    const output = fake.messages.join('\n');
    assert.match(output, /conn-1 re-pull failed .*HTTP 429, quota/);
    assert.match(output, /conn-2 re-pull failed .*Ga4AuthError \(reconnect the Google integration\)/);
    assert.match(output, /conn-3 re-pull failed .*TypeError \(unexpected value or request failure\)/);
    assert.doesNotMatch(output, /secret-value|access_token|refresh_token/);
});
