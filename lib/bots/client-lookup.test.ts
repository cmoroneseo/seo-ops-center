import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

import { handleBotClientLookup, parseBotClientQuery } from './client-lookup.ts';
import { hashBotKey } from './keys.ts';

const TOKEN = 'seo_bot_testtokenvalue';
const ORG = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const CURRENT = 'in.(active,onboarding,pending,paused)';

const alpha = { id: ID, name: 'Alpha', domain: 'alpha.example', status: 'active' };
const paused = { id: '44444444-4444-4444-8444-444444444444', name: 'Alpha Labs', domain: null, status: 'paused' };

function world(
    rows: Array<{ id: string; name: string; domain: string | null; status: string | null }> = [alpha],
    revokedAt: string | null = null,
) {
    const lookups: URLSearchParams[] = [];
    const admin = createClient('https://database.example.test', 'test-service-key', {
        global: {
            async fetch(input, init) {
                assert.equal(init?.method, 'GET');
                const url = new URL(String(input));
                if (url.pathname === '/rest/v1/bot_api_keys') {
                    const keys = url.searchParams.get('key_hash') === `eq.${hashBotKey(TOKEN)}`
                        ? [{ id: 'bot-id', organization_id: ORG, name: 'technical-seo', revoked_at: revokedAt }]
                        : [];
                    return Response.json(keys);
                }
                assert.equal(url.pathname, '/rest/v1/clients');
                assert.equal(url.searchParams.get('organization_id'), `eq.${ORG}`);
                assert.equal(url.searchParams.get('select'), 'id,name,domain,status');
                assert.equal(url.searchParams.get('order'), 'name.asc');
                lookups.push(url.searchParams);
                return Response.json(rows);
            },
        },
    });
    return {
        lookups,
        get: (query: string, authorization: string | null = `Bearer ${TOKEN}`) => handleBotClientLookup(
            new Request(`https://seo-ops.example.test/api/bots/clients?${query}`, {
                headers: authorization ? { Authorization: authorization } : {},
            }),
            () => admin,
        ),
    };
}

test('the client query parser trims names, sets defaults, and accepts boundary limits and direct ids', () => {
    assert.deepEqual(parseBotClientQuery(new URLSearchParams('name=+Alpha+')), {
        ok: true, query: { name: 'Alpha', id: null, match: 'exact', status: 'current', limit: 10 },
    });
    for (const limit of [1, 25]) {
        const result = parseBotClientQuery(new URLSearchParams(`id=${ID}&limit=${limit}`));
        assert.equal(result.ok && result.query.id, ID);
        assert.equal(result.ok && result.query.limit, limit);
    }
    assert.equal(parseBotClientQuery(new URLSearchParams(`name=${'a'.repeat(200)}`)).ok, true);
});

test('invalid client lookup params return a clear 400 before reading clients', async () => {
    const { get, lookups } = world();
    for (const query of [
        '', 'name=+', 'name=A', `name=${'a'.repeat(201)}`, 'id=nope', 'name=Alpha&id=',
        'name=Alpha&match=prefix', 'name=Alpha&status=active', 'name=Alpha&limit=0',
        'name=Alpha&limit=26', 'name=Alpha&limit=1.5', 'name=Alpha&limit=',
        'name=Alpha&limit=1e1', 'name=Alpha&name=Bravo', 'name=Alpha&organizationId=another-org',
    ]) {
        const response = await get(query);
        assert.equal(response.status, 400, query);
        const body = await response.json();
        assert.equal(body.code, 'invalid_request', query);
        assert.ok(body.error, query);
    }
    assert.equal(lookups.length, 0);
});

test('any live bot can look up clients in its organization by case-insensitive exact name', async () => {
    const { get, lookups } = world();
    const response = await get('name=+aLpHa+');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
        clients: [{ id: ID, name: 'Alpha', website: 'alpha.example', status: 'active', active: true }],
        truncated: false,
    });
    assert.equal(lookups[0].get('name'), 'ilike.aLpHa');
    assert.equal(lookups[0].get('status'), CURRENT);
    assert.equal(lookups[0].get('limit'), '11');
});

test('contains fetches one extra row for truncation', async () => {
    const { get, lookups } = world([alpha, paused]);
    const response = await get('name=lpH&match=contains&limit=1');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        clients: [{ id: ID, name: 'Alpha', website: 'alpha.example', status: 'active', active: true }],
        truncated: true,
    });
    assert.equal(lookups[0].get('name'), 'ilike.%lpH%');
    assert.equal(lookups[0].get('limit'), '2');
});

test('exact and contains match literal search characters', async () => {
    const { get, lookups } = world([]);
    const name = 'Al%_\\';
    await get(new URLSearchParams({ name }).toString());
    await get(new URLSearchParams({ name, match: 'contains' }).toString());
    assert.equal(lookups[0].get('name'), String.raw`ilike.Al\%\_\\`);
    assert.equal(lookups[1].get('name'), String.raw`ilike.%Al\%\_\\%`);

    await get(new URLSearchParams({ name: 'Al*.[x]' }).toString());
    await get(new URLSearchParams({ name: 'Al*.[x]', match: 'contains' }).toString());
    assert.equal(lookups[2].get('name'), String.raw`imatch.^Al\*\.\[x\]$`);
    assert.equal(lookups[3].get('name'), String.raw`imatch.Al\*\.\[x\]`);
});

test('direct lookup uses the id and still applies the status filter', async () => {
    const { get, lookups } = world([]);
    const response = await get(`id=${ID}&name=Alpha`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { clients: [], truncated: false });
    assert.equal(lookups[0].get('id'), `eq.${ID}`);
    assert.equal(lookups[0].has('name'), false);
    assert.equal(lookups[0].get('status'), CURRENT);
});

test('status=all includes inactive clients and maps each raw status to active', async () => {
    const rows = ['active', 'inactive', 'onboarding', 'paused', 'pending'].map(status => ({
        ...alpha, name: `Alpha ${status}`, domain: null, status,
    }));
    const { get, lookups } = world(rows);
    const response = await get('name=alpha&match=contains&status=all');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        clients: rows.map(({ id, name, status }) => ({ id, name, website: null, status, active: status !== 'inactive' })),
        truncated: false,
    });
    assert.equal(lookups[0].has('status'), false);
});

test('missing, malformed, unknown, and revoked bot keys cannot read clients', async () => {
    for (const [authorization, revokedAt, code] of [
        [null, null, 'missing_api_key'],
        ['Bearer other-token', null, 'invalid_api_key'],
        ['Bearer seo_bot_unknown', null, 'invalid_api_key'],
        [`Bearer ${TOKEN}`, '2026-11-20T00:00:00Z', 'invalid_api_key'],
    ] as const) {
        const { get, lookups } = world([alpha], revokedAt);
        const response = await get('name=Alpha', authorization);
        assert.equal(response.status, 401);
        assert.equal((await response.json()).code, code);
        assert.equal(lookups.length, 0);
    }
});
