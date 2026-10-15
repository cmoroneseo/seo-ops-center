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
