import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast } from './build.ts';
import { CampaignDeskRequestError, type CampaignDeskClient } from './client.ts';
import { forecastPayloadHash, hoursStringFromMinutes } from './contract.ts';
import {
    createForecastPreviewGet,
    createForecastStatusGet,
    createForecastSyncPost,
    createForecastUndoPost,
    type ForecastHttpDependencies,
    type ForecastSourceData,
} from './http.ts';
import { ForecastStoreUnavailable, type ForecastRunStore, type ForecastSyncRunRecord } from './store.ts';
import { CAMPAIGN_DESK_MEG_ORG_ID } from './flags.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-14T18:00:00.000Z');

function source(): ForecastSourceData {
    return {
        members: [
            { userId: 'user-carlos', displayName: 'Carlos Morones', email: 'cmorones@marketingempiregroup.com' },
            { userId: 'user-abel', displayName: 'Abel Miranda', email: 'amiranda@marketingempiregroup.com' },
        ],
        logs: [{
            id: 'a', userId: 'user-carlos', clientId: CLIENT, clientName: 'Northwind Plumbing',
            date: '2026-10-14', hours: 2, status: 'logged', importStatus: 'mapped',
        }],
        events: [],
        tasks: [],
    };
}

function memoryStore(seed: ForecastSyncRunRecord[] = []): ForecastRunStore & { runs: ForecastSyncRunRecord[] } {
    const runs = [...seed];
    return {
        runs,
        async listSucceeded(organizationId) {
            return runs
                .filter(run => run.organizationId === organizationId && run.status === 'succeeded')
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        },
        async findSucceededByHash(organizationId, payloadHash) {
            return runs.find(run =>
                run.organizationId === organizationId
                && run.status === 'succeeded'
                && run.payloadHash === payloadHash) ?? null;
        },
        async insertSucceeded(run) {
            if (runs.some(existing => existing.organizationId === run.organizationId && existing.status === 'succeeded' && existing.payloadHash === run.payloadHash)) {
                return { ok: false, conflict: true };
            }
            runs.push(run);
            return { ok: true, run };
        },
        async markUndone(organizationId, runId, undoneBy, undoneAt) {
            const run = runs.find(entry => entry.organizationId === organizationId && entry.id === runId);
            if (!run) return 'missing';
            if (run.status === 'undone') return 'already_undone';
            run.status = 'undone';
            run.undoneBy = undoneBy;
            run.undoneAt = undoneAt;
            return 'updated';
        },
    };
}

function harness(options: {
    role?: 'owner' | 'admin' | 'member';
    enabled?: boolean;
    store?: ForecastRunStore;
    source?: ForecastSourceData;
} = {}) {
    const calls = { load: 0, people: 0, upsert: 0, deleted: [] as string[] };
    const role = options.role ?? 'owner';
    const enabled = options.enabled ?? false;
    const client: CampaignDeskClient = {
        async listPeople() {
            calls.people += 1;
            return [
                { id: 'desk_carlos', email: 'cmorones@marketingempiregroup.com' },
                { id: 'desk_abel', email: 'amiranda@marketingempiregroup.com' },
            ];
        },
        async listClients() {
            return [];
        },
        async upsertRun(payload) {
            calls.upsert += 1;
            return { runId: payload.runId, idempotent: false };
        },
        async deleteRun(runId) {
            calls.deleted.push(runId);
            return { runId, idempotent: false };
        },
    };
    const store = options.store ?? memoryStore();
    let ids = 0;
    let tick = 0;
    const deps: ForecastHttpDependencies = {
        now: () => new Date(NOW.getTime() + (tick++) * 1000),
        newRunId: () => `11111111-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
        async authorize(organizationId) {
            if (organizationId === CAMPAIGN_DESK_MEG_ORG_ID) {
                return { ok: false, status: 403, error: 'Forbidden' };
            }
            if (role !== 'owner' && role !== 'admin') return { ok: false, status: 403, error: 'Forbidden' };
            return {
                ok: true,
                userId: 'user-carlos',
                actorName: 'Carlos Morones',
                organizationId,
                role,
            };
        },
        async load() {
            calls.load += 1;
            return options.source ?? source();
        },
        readiness() {
            return enabled
                ? { enabled: true, reason: null }
                : { enabled: false, reason: 'Campaign Desk sync is turned off.' };
        },
        listPeople: () => client.listPeople(),
        payloadVersion: () => 1,
        listClients: () => client.listClients(),
        loadClientLinks: async () => [],
        rememberNameMatches: async () => {},
        store,
        client,
    };
    return { calls, store, deps };
}

function previewUrl(weeks = '2026-10-12') {
    const params = new URLSearchParams({
        organizationId: ORG,
        today: '2026-10-14',
        timeZone: 'America/Los_Angeles',
        weeks,
    });
    return new Request(`https://seo-pm.test/api/forecast/preview?${params}`);
}

test('a member cannot preview, and the flag-off preview does not call Campaign Desk', async () => {
    const member = harness({ role: 'member' });
    assert.equal((await createForecastPreviewGet(member.deps)(previewUrl())).status, 403);
    assert.equal(member.calls.load, 0);
    assert.equal(member.calls.people, 0);

    const admin = harness({ enabled: false });
    const response = await createForecastPreviewGet(admin.deps)(previewUrl());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.connection.enabled, false);
    assert.equal(body.preview.syncDisabled, true);
    assert.equal(body.preview.sections[0].people[0].rows[0].hoursLabel, '2h 00m');
    assert.equal(body.preview.sections[0].people[0].matchLabel, '—');
    assert.equal(admin.calls.people, 0);
    assert.equal(admin.calls.upsert, 0);
});

test('sync is refused while the flag is off and does not store a run', async () => {
    const { deps, calls, store } = harness({ enabled: false });
    const response = await createForecastSyncPost(deps)(new Request('https://seo-pm.test/api/forecast/sync', {
        method: 'POST',
        body: JSON.stringify({
            organizationId: ORG,
            weekStarts: ['2026-10-12'],
            today: '2026-10-14',
            timeZone: 'America/Los_Angeles',
        }),
    }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /turned off/);
    assert.equal(calls.people, 0);
    assert.equal(calls.upsert, 0);
    assert.equal((await store.listSucceeded(ORG)).length, 0);
});

test('an enabled sync stores one run and a repeat does not call Campaign Desk again', async () => {
    const { deps, calls, store } = harness({ enabled: true });
    const post = createForecastSyncPost(deps);
    const request = () => new Request('https://seo-pm.test/api/forecast/sync', {
        method: 'POST',
        body: JSON.stringify({
            organizationId: ORG,
            weekStarts: ['2026-10-12'],
            today: '2026-10-14',
            timeZone: 'America/Los_Angeles',
        }),
    });
    const first = await post(request());
    assert.equal(first.status, 200);
    const created = await first.json();
    assert.equal(created.idempotent, false);
    assert.equal(created.syncedBy, 'Carlos Morones');
    assert.equal(calls.upsert, 1);
    const stored = await store.listSucceeded(ORG);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].payload.weeks[0].allocations[0].minutes, 120);
    assert.equal(stored[0].payload.weeks[0].allocations[0].hours, hoursStringFromMinutes(120));
    assert.equal(stored[0].payloadHash, forecastPayloadHash(stored[0].payload));

    const second = await post(request());
    assert.equal((await second.json()).idempotent, true);
    assert.equal(calls.upsert, 1);
    assert.equal((await store.listSucceeded(ORG)).length, 1);
});

test('undo deletes the latest run and status then says not synced', async () => {
    const box = harness({ enabled: true });
    const sync = await createForecastSyncPost(box.deps)(new Request('https://seo-pm.test/api/forecast/sync', {
        method: 'POST',
        body: JSON.stringify({
            organizationId: ORG,
            weekStarts: ['2026-10-12'],
            today: '2026-10-14',
            timeZone: 'America/Los_Angeles',
        }),
    }));
    const { runId } = await sync.json();
    const undo = await createForecastUndoPost(box.deps)(new Request('https://seo-pm.test/api/forecast/undo', {
        method: 'POST',
        body: JSON.stringify({ organizationId: ORG, runId }),
    }));
    assert.equal(undo.status, 200);
    assert.deepEqual(box.calls.deleted, [runId]);
    assert.equal((await box.store.listSucceeded(ORG)).length, 0);

    const status = await createForecastStatusGet(box.deps)(new Request(
        `https://seo-pm.test/api/forecast/status?organizationId=${ORG}&weekStart=2026-10-12&today=2026-10-14&timeZone=UTC`,
    ));
    const body = await status.json();
    assert.equal(body.lastSyncedLabel, 'Not synced yet');
    const carlos = body.members.find((member: { userId: string }) => member.userId === 'user-carlos');
    assert.equal(carlos.label, '—');
    assert.equal(carlos.reason, 'Not synced yet');
});

test('a missing sync table is an em dash, not a zero', async () => {
    const store: ForecastRunStore = {
        async listSucceeded() { throw new ForecastStoreUnavailable(); },
        async findSucceededByHash() { throw new ForecastStoreUnavailable(); },
        async insertSucceeded() { throw new ForecastStoreUnavailable(); },
        async markUndone() { throw new ForecastStoreUnavailable(); },
    };
    const { deps } = harness({ store });
    const response = await createForecastStatusGet(deps)(new Request(
        `https://seo-pm.test/api/forecast/status?organizationId=${ORG}&weekStart=2026-10-12&today=2026-10-14&timeZone=UTC`,
    ));
    const body = await response.json();
    assert.equal(body.available, false);
    assert.equal(body.lastSyncedLabel, '—');
    assert.match(body.lastSyncedReason, /not set up/);
    assert.deepEqual(body.members, []);
    assert.equal(JSON.stringify(body).includes('"0"'), false);
});

test('weeks outside the next three are rejected before any send', async () => {
    const { deps, calls } = harness({ enabled: true });
    const response = await createForecastSyncPost(deps)(new Request('https://seo-pm.test/api/forecast/sync', {
        method: 'POST',
        body: JSON.stringify({
            organizationId: ORG,
            weekStarts: ['2026-09-07'],
            today: '2026-10-14',
            timeZone: 'America/Los_Angeles',
        }),
    }));
    assert.equal(response.status, 400);
    assert.equal(calls.upsert, 0);
});

test('changed hours are a new run, and an older run cannot be undone', async () => {
    const firstSource = source();
    const box = harness({ enabled: true, source: firstSource });
    const post = createForecastSyncPost(box.deps);
    const send = (hours: number) => {
        box.deps.load = async () => ({
            ...source(),
            logs: [{ ...source().logs[0], hours }],
        });
        return post(new Request('https://seo-pm.test/api/forecast/sync', {
            method: 'POST',
            body: JSON.stringify({
                organizationId: ORG,
                weekStarts: ['2026-10-12'],
                today: '2026-10-14',
                timeZone: 'America/Los_Angeles',
            }),
        }));
    };
    const first = await (await send(2)).json();
    const second = await (await send(3)).json();
    assert.equal(box.calls.upsert, 2);
    assert.notEqual(first.runId, second.runId);
    const undoOld = await createForecastUndoPost(box.deps)(new Request('https://seo-pm.test/api/forecast/undo', {
        method: 'POST',
        body: JSON.stringify({ organizationId: ORG, runId: first.runId }),
    }));
    assert.equal(undoOld.status, 409);
    assert.equal(box.calls.deleted.length, 0);

    const status = await (await createForecastStatusGet(box.deps)(new Request(
        `https://seo-pm.test/api/forecast/status?organizationId=${ORG}&weekStart=2026-10-12&today=2026-10-14&timeZone=UTC`,
    ))).json();
    const carlos = status.members.find((member: { userId: string }) => member.userId === 'user-carlos');
    assert.equal(carlos.label, 'Synced');
    const abel = status.members.find((member: { userId: string }) => member.userId === 'user-abel');
    assert.equal(abel.label, 'Synced');
    assert.equal(abel.reason, null);
});

test('a Campaign Desk failure does not record a success', async () => {
    const { deps, store } = harness({ enabled: true });
    deps.client = {
        ...deps.client,
        async upsertRun() {
            throw new CampaignDeskRequestError(500, 'unavailable', 'Campaign Desk could not complete the sync.');
        },
    };
    const response = await createForecastSyncPost(deps)(new Request('https://seo-pm.test/api/forecast/sync', {
        method: 'POST',
        body: JSON.stringify({
            organizationId: ORG,
            weekStarts: ['2026-10-12'],
            today: '2026-10-14',
            timeZone: 'America/Los_Angeles',
        }),
    }));
    assert.equal(response.status, 502);
    assert.equal((await store.listSucceeded(ORG)).length, 0);
});

test('a people failure names the reason and logs lengths, not the secret', async () => {
    const secret = 'synthetic-campaign-desk-token';
    const previousUrl = process.env.CAMPAIGN_DESK_API_BASE_URL;
    const previousToken = process.env.CAMPAIGN_DESK_API_TOKEN;
    process.env.CAMPAIGN_DESK_API_BASE_URL = '  https://hub.example.test  ';
    process.env.CAMPAIGN_DESK_API_TOKEN = ` ${secret}\n`;
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try {
        const previewBox = harness({ enabled: true });
        previewBox.deps.listPeople = async () => {
            throw new CampaignDeskRequestError(403, 'unavailable', 'Campaign Desk could not complete the sync.', {
                path: '/v1/people',
                fetchErrorName: 'TypeError',
                fetchErrorMessage: `blocked ${secret}`,
            });
        };
        const preview = await createForecastPreviewGet(previewBox.deps)(previewUrl());
        const previewBody = await preview.json();
        assert.equal(previewBody.preview.syncDisabledReason, 'Campaign Desk people could not be loaded (403).');

        const syncBox = harness({ enabled: true });
        syncBox.deps.listPeople = async () => {
            throw new CampaignDeskRequestError(401, 'unauthorized', 'Campaign Desk rejected the sync key.', {
                path: '/v1/people',
            });
        };
        const sync = await createForecastSyncPost(syncBox.deps)(new Request('https://seo-pm.test/api/forecast/sync', {
            method: 'POST',
            body: JSON.stringify({
                organizationId: ORG,
                weekStarts: ['2026-10-12'],
                today: '2026-10-14',
                timeZone: 'America/Los_Angeles',
            }),
        }));
        assert.equal(sync.status, 502);
        assert.equal((await sync.json()).error, 'Campaign Desk people could not be loaded (unauthorized).');
        assert.equal(syncBox.calls.upsert, 0);

        const unreachable = harness({ enabled: true });
        unreachable.deps.listPeople = async () => {
            throw new CampaignDeskRequestError(0, 'unreachable', 'Campaign Desk could not be reached.', { path: '/v1/people' });
        };
        const missed = await createForecastPreviewGet(unreachable.deps)(previewUrl());
        assert.equal((await missed.json()).preview.syncDisabledReason, 'Campaign Desk people could not be loaded (unreachable).');

        const unreadable = harness({ enabled: true });
        unreadable.deps.listPeople = async () => {
            throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable people list.', { path: '/v1/people' });
        };
        const bad = await createForecastPreviewGet(unreadable.deps)(previewUrl());
        assert.equal((await bad.json()).preview.syncDisabledReason, 'Campaign Desk people could not be loaded (invalid response).');
    } finally {
        console.warn = original;
        if (previousUrl === undefined) delete process.env.CAMPAIGN_DESK_API_BASE_URL;
        else process.env.CAMPAIGN_DESK_API_BASE_URL = previousUrl;
        if (previousToken === undefined) delete process.env.CAMPAIGN_DESK_API_TOKEN;
        else process.env.CAMPAIGN_DESK_API_TOKEN = previousToken;
    }

    assert.equal(warnings.length, 4);
    for (const warning of warnings) {
        const line = JSON.parse(warning) as Record<string, unknown>;
        assert.equal(line.event, 'campaign_desk_request_failed');
        assert.equal(line.path, '/v1/people');
        assert.equal(line.baseUrlPresent, true);
        assert.equal(line.baseUrlLength, '  https://hub.example.test  '.length);
        assert.equal(line.tokenPresent, true);
        assert.equal(line.tokenLength, ` ${secret}\n`.length);
        assert.equal(warning.includes(secret), false);
        assert.equal(warning.includes('hub.example.test'), false);
    }
    const first = JSON.parse(warnings[0]) as { status: number; code: string; fetchErrorMessage: string };
    assert.equal(first.status, 403);
    assert.equal(first.code, 'unavailable');
    assert.equal(first.fetchErrorMessage, 'blocked [redacted]');
    assert.equal((JSON.parse(warnings[1]) as { status: number }).status, 401);
});

test('version 2 sends items and keeps version 1 when the flag is off', async () => {
    const taskId = '44444444-4444-4444-8444-444444444444';
    const logId = '55555555-5555-4555-8555-555555555555';
    const data = source();
    const box = harness({ enabled: true, source: data });
    const post = () => createForecastSyncPost(box.deps)(new Request('https://seo-pm.test/api/forecast/sync', {
        method: 'POST',
        body: JSON.stringify({
            organizationId: ORG,
            weekStarts: ['2026-10-12'],
            today: '2026-10-14',
            timeZone: 'America/Los_Angeles',
        }),
    }));
    const v1Response = await post();
    assert.equal(v1Response.status, 200);
    const v1Stored = await box.store.listSucceeded(ORG);
    assert.equal('version' in v1Stored[0].payload, false);
    assert.equal(v1Stored[0].payload.weeks[0].allocations[0].minutes, 120);
    assert.equal(box.calls.upsert, 1);

    data.logs = [{
        id: logId,
        userId: 'user-carlos',
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        clientDomain: 'northwind.example',
        date: '2026-10-14',
        hours: 1.5,
        status: 'logged',
        importStatus: 'mapped',
        taskId,
        taskTitle: 'Service pages',
    }];
    box.deps.payloadVersion = () => 2;
    box.deps.listClients = async () => [{ id: 'rc_north', name: 'Northwind Plumbing' }];
    const response = await post();
    assert.equal(response.status, 200);
    const stored = await box.store.listSucceeded(ORG);
    const payload = stored[0].payload;
    assert.equal('version' in payload && payload.version, 2);
    if (!('version' in payload) || payload.version !== 2) return;
    const sent = payload.weeks[0].people[0].days[0].items[0];
    assert.equal(sent.itemKey, `task:${taskId}:2026-10-14`);
    assert.equal(sent.minutes, 90);
    assert.equal(sent.hours, '1.50');
    assert.equal(sent.client?.domain, 'northwind.example');
    assert.equal(sent.client?.campaignDeskClientId, 'rc_north');
    assert.equal(JSON.stringify(payload).includes('allocations'), false);
    assert.equal(box.calls.upsert, 2);
    assert.notEqual(stored[0].id, v1Stored[0].id);
});

test('the builder used by the route does not touch the production org id', () => {
    const built = buildForecast({
        organizationId: ORG,
        today: '2026-10-14',
        timeZone: 'UTC',
        selectedWeekStarts: ['2026-10-12'],
        members: source().members,
        directory: null,
        logs: source().logs,
        events: [],
        tasks: [],
    });
    assert.equal(built.payloadBody.organizationId, ORG);
    assert.notEqual(ORG, CAMPAIGN_DESK_MEG_ORG_ID);
});
