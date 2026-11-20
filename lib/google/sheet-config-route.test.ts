import assert from 'node:assert/strict';
import test from 'node:test';
import { createSheetConfigHandlers } from './sheet-config-route.ts';

const sheetId = 'a'.repeat(25);
const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
const linked = { roadmap_sheet_url: sheetUrl, roadmap_sheet_id: sheetId };
const cleared = { roadmap_sheet_url: null, roadmap_sheet_id: null };
const authorization = {
    ok: true as const,
    clientId: 'client',
    organizationId: 'org',
    userId: 'user',
    actorName: 'User',
};

function fixture({ authorized = true, organizationId = 'org' } = {}) {
    const writes: unknown[] = [];
    const events: unknown[] = [];
    const reads: unknown[] = [];
    const handlers = createSheetConfigHandlers({
        async authorize(clientId) {
            assert.equal(clientId, 'client');
            return authorized ? authorization : { ok: false, status: 401, error: 'Unauthorized' };
        },
        createStore: () => ({
            async get(clientId, orgId) {
                reads.push([clientId, orgId]);
                return clientId === 'client' && orgId === organizationId ? linked : null;
            },
            async update(clientId, orgId, config) {
                assert.equal(clientId, 'client');
                assert.equal(orgId, organizationId);
                writes.push(config);
                return config;
            },
        }),
        async logActivity(event) { events.push(event); },
    });

    return {
        reads, writes, events,
        get: () => handlers.get('client'),
        post: (roadmap_sheet_url: unknown) => handlers.post(new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ roadmap_sheet_url }),
        }), 'client'),
    };
}

test('unauthorized requests are rejected before accessing the store', async () => {
    const { get, post, reads, writes, events } = fixture({ authorized: false });
    assert.equal((await get()).status, 401);
    assert.equal((await post(sheetUrl)).status, 401);
    assert.deepEqual([reads, writes, events], [[], [], []]);
});

test('GET returns sheet configuration scoped to the authorized organization', async () => {
    const { get, reads } = fixture();
    const response = await get();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), linked);
    assert.deepEqual(reads, [['client', 'org']]);
});

test('POST stores the normalized URL and derived ID and logs activity', async () => {
    const { post, writes, events } = fixture();
    const response = await post(` ${sheetUrl}#gid=42 `);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), linked);
    assert.deepEqual(writes, [linked]);
    assert.deepEqual(events, [{
        clientId: 'client',
        organizationId: 'org',
        actorId: 'user',
        actorName: 'User',
        eventType: 'integration.reconfigured',
        metadata: { service: 'google-sheets' },
    }]);
});

test('invalid URLs and missing or wrongly typed values return 400 without writing', async () => {
    const { post, writes, events } = fixture();
    for (const value of ['https://example.com/spreadsheets/d/' + sheetId, undefined, 123]) {
        const response = await post(value);
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /Google Sheets link/);
    }
    assert.deepEqual([writes, events], [[], []]);
});

test('empty string and null clear both columns', async () => {
    const { post, writes } = fixture();
    for (const value of ['', null]) {
        const response = await post(value);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), cleared);
    }
    assert.deepEqual(writes, [cleared, cleared]);
});

test('a client outside the authorized organization returns 404 without writing', async () => {
    const { get, post, writes, events } = fixture({ organizationId: 'other-org' });
    assert.equal((await get()).status, 404);
    assert.equal((await post(sheetUrl)).status, 404);
    assert.deepEqual([writes, events], [[], []]);
});
