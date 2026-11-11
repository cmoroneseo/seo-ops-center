import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDeskRequestError, type CampaignDeskClient } from './client.ts';
import { forecastPayloadHash } from './contract.ts';
import { executeForecastSync, type ForecastHttpDependencies } from './http.ts';
import { nudgeForecastSync } from './nudge.ts';
import {
    createForecastPushPost,
    createForecastPushScheduler,
    runForecastPush,
    type ForecastPushTarget,
    type ForecastPushTimer,
} from './push.ts';
import type { ForecastRunStore, ForecastSyncRunRecord } from './store.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';

function target(weekStart = '2026-10-12'): ForecastPushTarget {
    return {
        organizationId: ORG,
        weekStart,
        timeZone: 'America/Los_Angeles',
        today: '2026-10-14',
        userId: 'user-carlos',
        actorName: 'Carlos Morones',
        now: '2026-10-14T18:00:00.000Z',
    };
}

test('a burst of edits for one week sends once, and a failed send does not throw', async () => {
    const pushes: ForecastPushTarget[] = [];
    const errors: unknown[] = [];
    const queued = new Set<() => void>();
    const scheduler = createForecastPushScheduler({
        delayMs: 3000,
        schedule(_delay, run) {
            queued.add(run);
            const timer: ForecastPushTimer = {
                cancel() {
                    queued.delete(run);
                },
            };
            return timer;
        },
        async push(item) {
            pushes.push(item);
            if (item.weekStart === '2026-10-19') throw new Error('Campaign Desk could not complete the sync.');
        },
        onError(error) {
            errors.push(error);
        },
    });

    scheduler.schedule(target());
    scheduler.schedule({ ...target(), actorName: 'Abel Miranda' });
    scheduler.schedule(target('2026-10-19'));
    assert.equal(pushes.length, 0);
    assert.doesNotThrow(() => {
        for (const run of [...queued]) run();
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(pushes.length, 2);
    assert.equal(pushes[0]?.actorName, 'Abel Miranda');
    assert.equal(pushes[0]?.weekStart, '2026-10-12');
    assert.equal(pushes[1]?.weekStart, '2026-10-19');
    assert.equal(errors.length, 1);
});

test('a nudge never throws, even when the browser call fails', () => {
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    globalThis.window = {} as Window & typeof globalThis;
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;
    try {
        assert.doesNotThrow(() => nudgeForecastSync({
            organizationId: ORG,
            instants: ['2026-10-14T22:00:00.000Z'],
        }));
    } finally {
        globalThis.window = previousWindow;
        globalThis.fetch = previousFetch;
    }
});

function memoryStore(): ForecastRunStore & { runs: ForecastSyncRunRecord[] } {
    const runs: ForecastSyncRunRecord[] = [];
    return {
        runs,
        async listSucceeded(organizationId) {
            return runs.filter(run => run.organizationId === organizationId && run.status === 'succeeded');
        },
        async findSucceededByHash(organizationId, payloadHash) {
            return runs.find(run =>
                run.organizationId === organizationId
                && run.status === 'succeeded'
                && run.payloadHash === payloadHash) ?? null;
        },
        async insertSucceeded(run) {
            if (runs.some(existing =>
                existing.organizationId === run.organizationId
                && existing.status === 'succeeded'
                && existing.payloadHash === run.payloadHash)) {
                return { ok: false, conflict: true };
            }
            runs.push(run);
            return { ok: true, run };
        },
        async markUndone() {
            return 'missing';
        },
    };
}

function deps(options: { fail?: boolean; store?: ForecastRunStore } = {}) {
    const calls = { upsert: 0 };
    const client: CampaignDeskClient = {
        async listPeople() {
            return [{ id: 'desk_carlos', email: 'cmorones@marketingempiregroup.com' }];
        },
        async listClients() {
            return [{ id: 'rc_north', name: 'Northwind Plumbing' }];
        },
        async upsertRun(payload) {
            calls.upsert += 1;
            if (options.fail) {
                throw new CampaignDeskRequestError(500, 'unavailable', 'Campaign Desk could not complete the sync.');
            }
            return { runId: payload.runId, idempotent: false };
        },
        async deleteRun(runId) {
            return { runId, idempotent: false };
        },
    };
    let ids = 0;
    const harness: ForecastHttpDependencies = {
        now: () => new Date('2026-10-14T18:00:00.000Z'),
        newRunId: () => `11111111-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
        async authorize() {
            return { ok: false, status: 401, error: 'Unauthorized' };
        },
        async load() {
            return {
                members: [{
                    userId: 'user-carlos',
                    displayName: 'Carlos Morones',
                    email: 'cmorones@marketingempiregroup.com',
                }],
                logs: [{
                    id: '55555555-5555-4555-8555-555555555555',
                    userId: 'user-carlos',
                    clientId: CLIENT,
                    clientName: 'Northwind Plumbing',
                    clientDomain: 'northwind.example',
                    date: '2026-10-13',
                    hours: 1,
                    status: 'logged',
                    importStatus: 'mapped',
                }],
                events: [],
                tasks: [{
                    id: '44444444-4444-4444-8444-444444444444',
                    title: 'Later today',
                    status: 'todo',
                    assigneeIds: ['user-carlos'],
                    clientId: CLIENT,
                    clientName: 'Northwind Plumbing',
                    clientDomain: 'northwind.example',
                    startDate: '2026-10-14T22:00:00.000Z',
                    estimatedHours: 1,
                }],
            };
        },
        readiness() {
            return { enabled: true, reason: null };
        },
        listPeople: () => client.listPeople(),
        payloadVersion: () => 2,
        listClients: () => client.listClients(),
        loadClientLinks: async () => [{ clientId: CLIENT, campaignDeskClientId: 'rc_north', matchedBy: 'manual' }],
        rememberNameMatches: async () => {},
        store: options.store ?? memoryStore(),
        client,
    };
    return { harness, calls };
}

test('the same week pushed twice calls Campaign Desk once', async () => {
    const { harness, calls } = deps();
    const command = {
        organizationId: ORG,
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        actorName: 'Carlos Morones',
        today: '2026-10-14',
        timeZone: 'America/Los_Angeles',
        weekStarts: ['2026-10-12'],
        allowEmpty: true,
        now: '2026-10-14T18:00:00.000Z',
    };
    const first = await executeForecastSync(harness, command);
    const second = await executeForecastSync(harness, command);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.idempotent, false);
    assert.equal(second.idempotent, true);
    assert.equal(first.runId, second.runId);
    assert.equal(calls.upsert, 1);
    const stored = await harness.store.listSucceeded(ORG);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.payloadHash, forecastPayloadHash(stored[0]?.payload ?? {}));
});

test('a Campaign Desk failure does not fail the save and does not record a success', async () => {
    const store = memoryStore();
    const { harness } = deps({ fail: true, store });
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
        warnings.push(String(message));
    };
    try {
        await assert.doesNotReject(() => runForecastPush(harness, target()));
    } finally {
        console.warn = original;
    }
    assert.equal((await store.listSucceeded(ORG)).length, 0);
    assert.match(warnings.join('\n'), /campaign_desk_request_failed/);
});

test('the nudge answers before Campaign Desk runs', async () => {
    let ran = false;
    const post = createForecastPushPost({
        now: () => new Date('2026-10-14T18:00:00.000Z'),
        async authorize(organizationId) {
            return {
                ok: true,
                userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                actorName: 'Carlos Morones',
                organizationId,
            };
        },
        schedule() {
            ran = true;
            throw new Error('Campaign Desk could not complete the sync.');
        },
    });
    const response = await post(new Request('https://seo-pm.test/api/forecast/push', {
        method: 'POST',
        body: JSON.stringify({
            organizationId: ORG,
            weekStarts: ['2026-10-12', '2026-09-07'],
            today: '2026-10-14',
            timeZone: 'America/Los_Angeles',
        }),
    }));
    assert.equal(response.status, 202);
    assert.equal(ran, true);
    const ignored = await post(new Request('https://seo-pm.test/api/forecast/push', {
        method: 'POST',
        body: JSON.stringify({
            organizationId: ORG,
            weekStarts: ['2026-09-07'],
            today: '2026-10-14',
            timeZone: 'America/Los_Angeles',
        }),
    }));
    assert.equal(ignored.status, 202);
});
