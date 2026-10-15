import test from 'node:test';
import assert from 'node:assert/strict';
import { GA4_HISTORY_SANDBOX_ORG_ID } from './flags.ts';
import { Ga4AuthError, runGa4Cron, runGa4QueueMessage, type Ga4Job, type Ga4QueueKind, type Ga4QueueSend, type Ga4Release, type Ga4RunDeps, type Ga4Store } from './run.ts';
import type { Ga4DayWrite } from './sync.ts';

const ORG = GA4_HISTORY_SANDBOX_ORG_ID;
const RUN = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-15T11:00:00Z');

function onEnv(backfill = false): NodeJS.ProcessEnv {
    return {
        GA4_HISTORY_ENABLED: 'true',
        GA4_BACKFILL_ENABLED: backfill ? 'true' : 'false',
        GA4_ORG_IDS: ORG,
    } as NodeJS.ProcessEnv;
}

function memoryStore(seed: { daily?: boolean; backfill?: boolean } = {}): Ga4Store & {
    days: Ga4DayWrite[];
    releases: Ga4Release[];
    reauths: number;
    claimed: Ga4QueueKind[];
} {
    const jobs: Record<Ga4QueueKind, boolean> = { daily: Boolean(seed.daily), backfill: Boolean(seed.backfill) };
    const state = {
        days: [] as Ga4DayWrite[],
        releases: [] as Ga4Release[],
        reauths: 0,
        claimed: [] as Ga4QueueKind[],
    };
    const job = (kind: Ga4QueueKind): Ga4Job => ({
        id: kind, organizationId: ORG, clientId: '33333333-3333-4333-8333-333333333333',
        property: 'properties/1', kind, leaseToken: 'lease', attempts: 1, cursorDate: kind === 'backfill' ? null : null,
    });
    const store: Ga4Store & typeof state = {
        ...state,
        async listConnected() { return [{ clientId: job('daily').clientId, propertyId: 'properties/1' }]; },
        async enqueueDaily() { jobs.daily = true; return true; },
        async enqueueBackfill() { jobs.backfill = true; return true; },
        async hasWork(kind) { return jobs[kind]; },
        async claim(kind) {
            if (!jobs[kind]) return null;
            store.claimed.push(kind);
            jobs[kind] = false;
            return job(kind);
        },
        async release(input) {
            store.releases.push(input);
            jobs[input.id as Ga4QueueKind] = input.status === 'pending';
        },
        async replaceDay(_job, _fetchedAt, day) { store.days.push(day); return true; },
        async keyEventOverride() { return null; },
        async markSynced() { return undefined; },
        async markReauth() { store.reauths += 1; },
        async markFailed() { return undefined; },
    };
    return store;
}

function deps(store: Ga4Store, extra: Partial<Ga4RunDeps> = {}): Ga4RunDeps & { sent: Ga4QueueSend[] } {
    const sent: Ga4QueueSend[] = [];
    return {
        sent,
        env: onEnv(true),
        now: () => NOW,
        newRunId: () => RUN,
        store,
        publish: async message => { sent.push(message); },
        getToken: async () => ({ token: 'token' }),
        listKeyEvents: async () => ['purchase'],
        readRange: async () => ({
            ok: true,
            reports: { totals: { rows: [] }, organic: { rows: [] }, events: { rows: [] }, landing: { rows: [] } },
            quota: { tokensPerHour: { consumed: 1, remaining: 39999 } },
        }),
        ...extra,
    };
}

test('flags off skips the cron without publishing', async () => {
    const store = memoryStore();
    const ran = deps(store, { env: {} as NodeJS.ProcessEnv });
    assert.deepEqual(await runGa4Cron(ran), { skipped: true, reason: 'flag_off' });
    assert.equal(ran.sent.length, 0);
});

test('the nightly cron publishes one daily chain and one backfill chain', async () => {
    const store = memoryStore();
    const ran = deps(store);
    const result = await runGa4Cron(ran);
    assert.deepEqual(result, { daily: true, backfill: true });
    assert.deepEqual(ran.sent.map(message => message.kind), ['daily', 'backfill']);
    assert.equal(ran.sent[0]?.idempotencyKey, 'ga4-backfill:2026-10-15:daily:1');
});

test('a daily message writes three null days, leaves yesterday open, and does not invent zeros', async () => {
    const store = memoryStore({ daily: true });
    const ran = deps(store);
    await runGa4QueueMessage({ runId: RUN, chain: 1, kind: 'daily' }, ran);
    assert.deepEqual(store.days.map(day => day.day), ['2026-10-12', '2026-10-13', '2026-10-14']);
    assert.equal(store.days[0]?.isFinal, true);
    assert.equal(store.days[2]?.isFinal, false);
    for (const day of store.days) {
        assert.equal(day.daily.sessions, null);
        assert.equal(day.daily.organic_sessions, null);
        assert.equal(day.daily.key_events, null);
    }
    assert.equal(store.releases[0]?.status, 'idle');
    assert.equal(store.reauths, 0);
});

test('HTTP 429 writes nothing and the next message waits out the backoff', async () => {
    const store = memoryStore({ daily: true, backfill: false });
    store.hasWork = async () => true;
    const ran = deps(store, { readRange: async () => ({ ok: false, status: 429, quota: null }) });
    await runGa4QueueMessage({ runId: RUN, chain: 1, kind: 'daily' }, ran);
    assert.equal(store.days.length, 0);
    assert.equal(store.releases[0]?.lastError, 'quota');
    assert.equal(store.releases[0]?.status, 'pending');
    assert.equal(ran.sent[0]?.delaySeconds, 15 * 60);
});

test('under 20 percent hourly tokens the saved month is kept and the chain waits', async () => {
    const store = memoryStore({ backfill: true });
    const ran = deps(store, {
        readRange: async () => ({
            ok: true,
            reports: { totals: { rows: [] }, organic: { rows: [] }, events: { rows: [] }, landing: { rows: [] } },
            quota: { tokensPerHour: { consumed: 39000, remaining: 1000 } },
        }),
    });
    await runGa4QueueMessage({ runId: RUN, chain: 1, kind: 'backfill' }, ran);
    assert.equal(store.days.length, 14);
    assert.equal(store.days.every(day => day.daily.sessions === null), true);
    assert.equal(store.releases[0]?.cursorDate, '2026-10-01');
    assert.equal(store.releases[0]?.status, 'pending');
    assert.equal(store.releases[0]?.lastError, 'quota');
    assert.equal(ran.sent[0]?.delaySeconds, 15 * 60);
    assert.equal(ran.sent[0]?.kind, 'backfill');
});

test('a revoked token becomes reauth and does not write a day', async () => {
    const store = memoryStore({ daily: true });
    const ran = deps(store, { getToken: async () => { throw new Ga4AuthError('expired', 'reauth_required'); } });
    await runGa4QueueMessage({ runId: RUN, chain: 1, kind: 'daily' }, ran);
    assert.equal(store.days.length, 0);
    assert.equal(store.reauths, 1);
    assert.equal(store.releases[0]?.lastError, 'reauth');
});

test('the next backfill message walks one month older and a finished cursor stops', async () => {
    const store = memoryStore({ backfill: true });
    let cursor: string | null = '2026-10-01';
    store.claim = async kind => {
        if (kind !== 'backfill') return null;
        return {
            id: 'backfill', organizationId: ORG, clientId: '33333333-3333-4333-8333-333333333333',
            property: 'properties/1', kind, leaseToken: 'lease', attempts: 1, cursorDate: cursor,
        };
    };
    store.release = async input => { cursor = input.cursorDate ?? cursor; store.releases.push(input); };
    const ran = deps(store);
    await runGa4QueueMessage({ runId: RUN, chain: 2, kind: 'backfill' }, ran);
    assert.equal(store.days[0]?.day, '2026-09-01');
    assert.equal(store.days.at(-1)?.day, '2026-09-30');
    assert.equal(store.releases[0]?.cursorDate, '2026-09-01');
    assert.equal(new Set(store.days.map(day => day.day)).size, store.days.length);
});
