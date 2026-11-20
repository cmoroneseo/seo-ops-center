import assert from 'node:assert/strict';
import test from 'node:test';
import { createSheetConfigHandlers } from './sheet-config-route.ts';

const sheetId = 'a'.repeat(25);
const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
const link = { roadmap_sheet_url: sheetUrl, roadmap_sheet_id: sheetId };
const linked = { ...link, sheet_mirror_enabled: true };
const cleared = { roadmap_sheet_url: null, roadmap_sheet_id: null, sheet_mirror_enabled: false };
const authorization = {
    ok: true as const,
    clientId: 'client',
    organizationId: 'org',
    userId: 'user',
    actorName: 'User',
};

function fixture({ deniedStatus = 0, organizationId = 'org', config = linked } = {}) {
    const writes: unknown[] = [];
    const events: unknown[] = [];
    const reads: unknown[] = [];
    const handlers = createSheetConfigHandlers({
        async authorize(clientId) {
            assert.equal(clientId, 'client');
            return deniedStatus ? { ok: false, status: deniedStatus, error: 'Access denied' } : authorization;
        },
        createStore: () => ({
            async get(clientId, orgId) {
                reads.push([clientId, orgId]);
                return clientId === 'client' && orgId === organizationId ? config : null;
            },
            async update(clientId, orgId, patch) {
                assert.equal(clientId, 'client');
                assert.equal(orgId, organizationId);
                writes.push(patch);
                return { ...config, ...patch };
            },
        }),
        async logActivity(event) { events.push(event); },
    });

    return {
        reads, writes, events,
        patch: (body: string) => handlers.patch(new Request('http://localhost', { method: 'PATCH', body }), 'client'),
        get: () => handlers.get('client'),
        post: (roadmap_sheet_url: unknown) => handlers.post(new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ roadmap_sheet_url }),
        }), 'client'),
    };
}

test('unauthorized requests are rejected before accessing the store', async () => {
    const { get, post, reads, writes, events } = fixture({ deniedStatus: 401 });
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
    assert.deepEqual(writes, [link]);
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

test('empty string and null clear the link and turn off the mirror', async () => {
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

test('PATCH honors the sheet-config authorizer before reading or writing', async () => {
    for (const status of [401, 403]) {
        const { patch, reads, writes, events } = fixture({ deniedStatus: status });
        assert.equal((await patch('{"enabled":true}')).status, status);
        assert.deepEqual([reads, writes, events], [[], [], []]);
    }
});

test('PATCH rejects invalid bodies before accessing the store', async () => {
    const { patch, reads, writes, events } = fixture();
    for (const body of ['', '{}', 'null', '[]', 'true', '{"enabled":"true"}', '{"enabled":1}',
        '{"enabled":null}', '{"enabled":true,"extra":false}']) {
        assert.equal((await patch(body)).status, 400);
    }
    assert.deepEqual([reads, writes, events], [[], [], []]);
});

test('PATCH cannot enable an unlinked client', async () => {
    const { patch, writes, events } = fixture({ config: cleared });
    assert.equal((await patch('{"enabled":true}')).status, 409);
    assert.deepEqual([writes, events], [[], []]);
});

test('PATCH changes the switch without modifying the sheet link and logs activity', async () => {
    for (const enabled of [true, false]) {
        const { patch, writes, events } = fixture({ config: { ...linked, sheet_mirror_enabled: !enabled } });
        const response = await patch(JSON.stringify({ enabled }));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ...linked, sheet_mirror_enabled: enabled });
        assert.deepEqual(writes, [{ sheet_mirror_enabled: enabled }]);
        assert.deepEqual(events, [{
            clientId: 'client',
            organizationId: 'org',
            actorId: 'user',
            actorName: 'User',
            eventType: 'integration.reconfigured',
            metadata: { service: 'google-sheets' },
        }]);
    }
});
