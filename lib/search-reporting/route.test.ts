import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchReportingHandler } from './route';
import type { LoadInput, LoadedSearch } from './load';

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';

function emptyLoad(): LoadedSearch {
    return {
        connected: true,
        property: 'sc-domain:example.com',
        clientName: 'Scott Cole',
        cityTokens: [],
        days: [],
        facts: [],
        ahrefsRows: [],
        ahrefsSyncedAt: null,
        lastSyncAt: '2026-10-08T15:00:00.000Z',
        lastSyncErrored: false,
    };
}

function handler(options: { enabled?: boolean; fail?: string; connected?: boolean } = {}) {
    const calls: { load?: LoadInput; scheduled: boolean } = { scheduled: false };
    const api = createSearchReportingHandler({
        authorize: async (clientId) => clientId === client
            ? { ok: true, userId: 'user', organizationId: org, clientId: client, role: 'member' }
            : { ok: false, status: 403, error: 'Forbidden' },
        enabled: () => options.enabled !== false,
        load: async (input) => {
            calls.load = input;
            if (options.fail) throw new Error(options.fail);
            return { ...emptyLoad(), connected: options.connected !== false };
        },
        schedule: () => { calls.scheduled = true; },
        now: () => new Date('2026-10-09T18:00:00.000Z'),
    });
    return { api, calls };
}

test('a cross-org client is forbidden before any read', async () => {
    const { api, calls } = handler();
    const response = await api(new Request(`https://app.test/api/integrations/google/gsc/insights?view=v2&clientId=${foreign}&orgId=${org}`));
    assert.equal(response.status, 403);
    assert.equal(calls.load, undefined);
    assert.equal(calls.scheduled, false);
});

test('the v2 view stays hidden unless search reporting is enabled', async () => {
    const { api, calls } = handler({ enabled: false });
    const response = await api(new Request(`https://app.test/api/integrations/google/gsc/insights?view=v2&clientId=${client}`));
    assert.equal(response.status, 404);
    assert.equal(calls.load, undefined);
});

test('the loader receives the membership organization, never a browser org id', async () => {
    const { api, calls } = handler();
    const response = await api(new Request(`https://app.test/api/integrations/google/gsc/insights?view=v2&clientId=${client}&orgId=99999999-9999-4999-8999-999999999999&range=2026-09`));
    assert.equal(response.status, 200);
    assert.equal(calls.load?.organizationId, org);
    assert.equal(calls.load?.clientId, client);
    assert.equal(calls.scheduled, true);
    const body = await response.json();
    assert.equal(body.view, 'v2');
    assert.equal(body.summary.totals.allGoogleSearch, null);
    assert.equal(body.tracker.audience, 'staff');
    assert.equal(body.tracker.dfs.available, false);
    assert.equal(body.tracker.dfs.value, null);
    assert.equal(body.tracker.dfs.rows.length, 0);
    assert.equal(body.tracker.dfs.reason, 'Partial');
    assert.equal(body.tracker.dfs.detail, 'not collected yet');
    assert.equal(body.tracker.anomaly_open, false);
});

test('a read failure does not echo the upstream message', async () => {
    const { api } = handler({ fail: 'secret token from postgres' });
    const response = await api(new Request(`https://app.test/api/integrations/google/gsc/insights?view=v2&clientId=${client}`));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, 'Unable to read Search Console history');
    assert.equal(JSON.stringify(body).includes('secret'), false);
});

test('invalid device and range are rejected', async () => {
    const { api, calls } = handler();
    assert.equal((await api(new Request(`https://app.test/api/integrations/google/gsc/insights?view=v2&clientId=${client}&device=phone`))).status, 400);
    assert.equal((await api(new Request(`https://app.test/api/integrations/google/gsc/insights?view=v2&clientId=${client}&range=September`))).status, 400);
    assert.equal(calls.load, undefined);
});
