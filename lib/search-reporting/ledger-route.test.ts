import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerHandler } from './ledger-route';
import type { LedgerLoadInput } from './ledger-load';
import type { LedgerSource } from './ledger';

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';

function source(): LedgerSource {
    return {
        clientId: client,
        clientDomain: 'example.com',
        connected: false,
        property: null,
        lastSyncAt: null,
        lastSyncErrored: false,
        historyStart: null,
        earliestStoredDay: null,
        historyDays: 0,
        unsurfacedRows: 0,
        days: [],
        facts: [],
        deliverables: [],
    };
}

function handler(options: { enabled?: boolean; fail?: boolean } = {}) {
    const calls: { load?: LedgerLoadInput } = {};
    const api = createLedgerHandler({
        authorize: async (clientId) => clientId === client
            ? { ok: true, organizationId: org, clientId: client }
            : { ok: false, status: 403, error: 'Forbidden' },
        enabled: () => options.enabled !== false,
        load: async (input) => {
            calls.load = input;
            if (options.fail) throw new Error('secret token from postgres');
            return source();
        },
        now: () => new Date('2026-10-09T18:00:00.000Z'),
    });
    return { api, calls };
}

test('a cross-org client is forbidden before the ledger is read', async () => {
    const { api, calls } = handler();
    const response = await api(new Request(`https://app.test/api/search-reporting/ledger?clientId=${foreign}&orgId=${org}`));
    assert.equal(response.status, 403);
    assert.equal(calls.load, undefined);
    const body = await response.json();
    assert.equal(body.error, 'Forbidden');
});

test('the ledger stays hidden unless search reporting is enabled', async () => {
    const { api, calls } = handler({ enabled: false });
    const response = await api(new Request(`https://app.test/api/search-reporting/ledger?clientId=${client}`));
    assert.equal(response.status, 404);
    assert.equal(calls.load, undefined);
});

test('the loader uses the membership organization, never a browser org id', async () => {
    const { api, calls } = handler();
    const response = await api(new Request(`https://app.test/api/search-reporting/ledger?clientId=${client}&orgId=99999999-9999-4999-8999-999999999999&range=2026-09`));
    assert.equal(response.status, 200);
    assert.equal(calls.load?.organizationId, org);
    assert.equal(calls.load?.clientId, client);
    assert.equal(calls.load?.range, '2026-09');
    const body = await response.json();
    assert.equal(body.latest, null);
    assert.equal(body.empty, 'No shipped work recorded yet. Work shows up here once it has a ship date and a page URL.');
    assert.equal(JSON.stringify(body).includes('99999999'), false);
});

test('a read failure does not echo the upstream message', async () => {
    const { api } = handler({ fail: true });
    const response = await api(new Request(`https://app.test/api/search-reporting/ledger?clientId=${client}`));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, 'Unable to read the results ledger');
    assert.equal(JSON.stringify(body).includes('secret'), false);
});
