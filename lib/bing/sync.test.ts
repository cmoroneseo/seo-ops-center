import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planBingAutoMap, type BingClientRow, type BingIntegrationRow, type BingMapAction } from './match.ts';
import {
    cronAuthorized, runBingCron, runBingQueueMessage,
    type BingJob, type BingRelease, type BingRunDeps, type BingStore,
} from './run.ts';
import {
    BING_CHAIN_LIMIT, BING_CRON_PATH, BING_CRON_SCHEDULE, BING_HARD_FAIL_DELAY_SECONDS,
    BING_PARK_SECONDS, BING_QUEUE_PATH, BING_QUEUE_RETENTION_SECONDS, BING_RESYNC_COOLDOWN_SECONDS,
    BING_SITE_DELAY_SECONDS,
    BING_SYNC_FAILED_MESSAGE, BING_UNVERIFIED_MESSAGE, bingBackoffSeconds, parseBingQueueMessage,
    type BingQueueSend, type SiteReadOutcome,
} from './sync.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const RUN = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-14T12:00:00.000Z');
const KEY = 'synthetic-bing-key';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

function onEnv(): NodeJS.ProcessEnv {
    return env({ BING_WEBMASTER: 'true', BING_WEBMASTER_ORG_IDS: ORG, BING_WEBMASTER_API_KEY: KEY });
}

function client(
    id: string,
    domain: string | null,
    status = 'active',
    organizationId = ORG,
    gscSiteUrl: string | null = null,
): BingClientRow {
    return { id, organizationId, domain, status, gscSiteUrl };
}

function integration(
    clientId: string,
    siteUrl: string | null,
    syncStatus: string,
    organizationId = ORG,
): BingIntegrationRow {
    return { clientId, organizationId, syncStatus, siteUrl };
}

function kinds(actions: BingMapAction[]): string[] {
    return actions.map(action => action.kind);
}

test('verified hosts map onto one active client and keep the exact URL', () => {
    const actions = planBingAutoMap({
        sites: [
            { siteUrl: 'https://example.test/blog', verified: true },
            { siteUrl: 'https://WWW.Other.TEST:443/path', verified: true },
            { siteUrl: 'https://skipped.test/', verified: false },
        ],
        clients: [
            client('c1', 'www.Example.TEST'),
            client('c2', 'other.test'),
            client('c3', 'skipped.test'),
        ],
        integrations: [],
    });
    assert.deepEqual(actions, [
        { kind: 'insert', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/blog' },
        { kind: 'insert', organizationId: ORG, clientId: 'c2', siteUrl: 'https://WWW.Other.TEST:443/path' },
    ]);
});

test('ambiguous, unverified, paused, and duplicate clients are not chosen', () => {
    assert.deepEqual(kinds(planBingAutoMap({
        sites: [
            { siteUrl: 'https://example.test/', verified: true },
            { siteUrl: 'https://example.test/blog', verified: true },
        ],
        clients: [client('c1', 'example.test')],
        integrations: [],
    })), []);
    assert.deepEqual(kinds(planBingAutoMap({
        sites: [{ siteUrl: 'https://example.test/', verified: false }],
        clients: [client('c1', 'example.test')],
        integrations: [],
    })), []);
    assert.deepEqual(kinds(planBingAutoMap({
        sites: [{ siteUrl: 'https://example.test/', verified: true }],
        clients: [client('c1', 'example.test'), client('c2', 'www.example.test')],
        integrations: [],
    })), []);
    assert.deepEqual(kinds(planBingAutoMap({
        sites: [{ siteUrl: 'https://paused.example.test/', verified: true }],
        clients: [client('c1', 'paused.example.test', 'pending')],
        integrations: [],
    })), []);
});

test('a null domain maps from the Search Console property', () => {
    assert.deepEqual(planBingAutoMap({
        sites: [{ siteUrl: 'https://www.ecoworkz.net/', verified: true }],
        clients: [client('c1', null, 'active', ORG, 'sc-domain:ecoworkz.net')],
        integrations: [],
    }), [{ kind: 'insert', organizationId: ORG, clientId: 'c1', siteUrl: 'https://www.ecoworkz.net/' }]);
    assert.deepEqual(planBingAutoMap({
        sites: [{ siteUrl: 'https://www.12voltpower.com/', verified: true }],
        clients: [client('c2', null, 'active', ORG, 'https://www.12voltpower.com/')],
        integrations: [],
    }), [{ kind: 'insert', organizationId: ORG, clientId: 'c2', siteUrl: 'https://www.12voltpower.com/' }]);
});

test('a stored domain wins over the Search Console property', () => {
    assert.deepEqual(planBingAutoMap({
        sites: [
            { siteUrl: 'https://www.12voltpower.com/', verified: true },
            { siteUrl: 'https://www.ecoworkz.net/', verified: true },
        ],
        clients: [client('c1', 'www.12voltpower.com', 'active', ORG, 'sc-domain:ecoworkz.net')],
        integrations: [],
    }), [{ kind: 'insert', organizationId: ORG, clientId: 'c1', siteUrl: 'https://www.12voltpower.com/' }]);
});

test('two clients that share a Search Console host are not mapped', () => {
    assert.deepEqual(planBingAutoMap({
        sites: [{ siteUrl: 'https://www.ecoworkz.net/', verified: true }],
        clients: [
            client('c1', null, 'active', ORG, 'sc-domain:ecoworkz.net'),
            client('c2', null, 'active', ORG, 'https://www.ecoworkz.net/'),
        ],
        integrations: [],
    }), []);
});

test('existing rows are enqueued, left alone, or marked unverified', () => {
    const same = planBingAutoMap({
        sites: [{ siteUrl: 'https://example.test/', verified: true }],
        clients: [client('c1', 'example.test')],
        integrations: [integration('c1', 'https://example.test/', 'error')],
    });
    assert.deepEqual(same, [{ kind: 'enqueue', organizationId: ORG, clientId: 'c1' }]);

    const different = planBingAutoMap({
        sites: [{ siteUrl: 'https://example.test/', verified: true }],
        clients: [client('c1', 'example.test')],
        integrations: [integration('c1', 'https://old.example.test/', 'active')],
    });
    assert.deepEqual(different, [{
        kind: 'markUnverified', organizationId: ORG, clientId: 'c1', siteUrl: 'https://old.example.test/',
    }]);

    const pending = planBingAutoMap({
        sites: [{ siteUrl: 'https://example.test/', verified: true }],
        clients: [client('c1', 'example.test')],
        integrations: [integration('c1', 'https://example.test/', 'pending_setup')],
    });
    assert.deepEqual(pending, []);

    const disconnected = planBingAutoMap({
        sites: [],
        clients: [client('c1', 'example.test')],
        integrations: [integration('c1', 'https://example.test/', 'disconnected')],
    });
    assert.deepEqual(disconnected, []);

    const paused = planBingAutoMap({
        sites: [{ siteUrl: 'https://example.test/', verified: true }],
        clients: [client('c1', 'example.test', 'pending')],
        integrations: [integration('c1', 'https://example.test/', 'active')],
    });
    assert.deepEqual(paused, []);

    const gone = planBingAutoMap({
        sites: [{ siteUrl: 'https://example.test/', verified: false }],
        clients: [client('c1', 'example.test', 'pending')],
        integrations: [integration('c1', 'https://example.test/', 'active')],
    });
    assert.deepEqual(gone, [{
        kind: 'markUnverified', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/',
    }]);
});

interface Memory {
    inserts: { organizationId: string; clientId: string; siteUrl: string }[];
    unverified: { organizationId: string; clientId: string; siteUrl: string }[];
    enqueued: string[];
    replaces: unknown[];
    synced: string[];
    failed: string[];
    releases: BingRelease[];
    jobs: BingJob[];
    parked: boolean;
}

function memory(seed?: { integrations?: BingIntegrationRow[]; job?: BingJob }): { store: BingStore; state: Memory } {
    const state: Memory = {
        inserts: [], unverified: [], enqueued: [], replaces: [], synced: [], failed: [], releases: [],
        jobs: seed?.job ? [seed.job] : [], parked: false,
    };
    const integrations = seed?.integrations ?? [];
    const store: BingStore = {
        async listClients() { return []; },
        async listIntegrations() { return integrations; },
        async listSyncRanks() { return []; },
        async insertMapping(action) {
            state.inserts.push(action);
            return true;
        },
        async markUnverified(action) {
            state.unverified.push(action);
            state.parked = true;
            state.jobs = [];
        },
        async enqueue(_organizationId, clientId) {
            state.enqueued.push(clientId);
            return true;
        },
        async claim() {
            if (state.parked) return null;
            const job = state.jobs.shift() ?? null;
            if (!job) return null;
            return { ...job, attempts: job.attempts + 1 };
        },
        async release(input) { state.releases.push(input); },
        async replace(input) {
            state.replaces.push(input);
            return true;
        },
        async markSynced(job) { state.synced.push(job.clientId); },
        async markFailed(job, message) {
            assert.equal(message, BING_SYNC_FAILED_MESSAGE);
            state.failed.push(job.clientId);
        },
    };
    return { store, state };
}

function deps(store: BingStore, overrides: Partial<BingRunDeps> = {}): BingRunDeps & { published: BingQueueSend[]; fetched: number } {
    const published: BingQueueSend[] = [];
    const calls = { fetched: 0 };
    const base: BingRunDeps = {
        env: onEnv(),
        now: () => NOW,
        newRunId: () => RUN,
        fetchSites: async () => {
            calls.fetched += 1;
            return { d: [] };
        },
        readSite: async () => ({ action: 'fail' }),
        store,
        publish: async message => { published.push(message); },
    };
    const merged = { ...base, ...overrides, publish: overrides.publish ?? base.publish };
    return {
        ...merged,
        published,
        get fetched() { return calls.fetched; },
    };
}

test('the cron stays quiet when the flag or the key is missing', async () => {
    const quiet = memory();
    const off = deps(quiet.store, { env: env({ BING_WEBMASTER: 'true', BING_WEBMASTER_ORG_IDS: ORG }) });
    assert.deepEqual(await runBingCron(off), { skipped: true, reason: 'missing_key' });
    assert.equal(off.fetched, 0);
    const disabled = deps(quiet.store, { env: env({}) });
    assert.deepEqual(await runBingCron(disabled), { skipped: true, reason: 'flag_off' });
    assert.equal(disabled.fetched, 0);
    assert.deepEqual(quiet.state.unverified, []);
    assert.deepEqual(quiet.state.replaces, []);
});

test('a failed site list does not mark clients unverified', async () => {
    const { store, state } = memory({
        integrations: [integration('c1', 'https://example.test/', 'active')],
    });
    const run = deps(store, { fetchSites: async () => { throw new Error(`apikey=${KEY}`); } });
    assert.deepEqual(await runBingCron(run), { error: 'Bing sync will retry on the next run.' });
    assert.deepEqual(state.unverified, []);
    assert.deepEqual(state.enqueued, []);
    assert.deepEqual(run.published, []);
});

test('a matched host is inserted and enqueued', async () => {
    const { store, state } = memory();
    const run = deps(store, {
        fetchSites: async () => ({ d: [{ Url: 'https://example.test/blog', IsVerified: true }] }),
    });
    run.store = {
        ...store,
        listClients: async () => [client('c1', 'www.example.test')],
        listIntegrations: async () => [],
    };
    assert.deepEqual(await runBingCron(run), { enqueued: 1, continued: true });
    assert.deepEqual(state.inserts, [{
        organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/blog',
    }]);
    assert.deepEqual(state.enqueued, ['c1']);
    assert.deepEqual(state.replaces, []);
});

test('an unverified mapped site is parked and the worker does not write', async () => {
    const job: BingJob = {
        id: 'job-1', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/',
        leaseToken: 'lease-1', attempts: 0,
    };
    const { store, state } = memory({
        integrations: [integration('c1', 'https://example.test/', 'active')],
        job,
    });
    const clients = [client('c1', 'example.test')];
    const run = deps(store, {
        fetchSites: async () => ({ d: [{ Url: 'https://example.test/', IsVerified: false, AuthenticationCode: 'drop-this-token' }] }),
    });
    run.store = {
        ...store,
        listClients: async () => clients,
        listIntegrations: async () => [integration('c1', 'https://example.test/', 'active')],
    };
    const result = await runBingCron(run);
    assert.deepEqual(result, { enqueued: 0, continued: true });
    assert.deepEqual(state.unverified, [{
        organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/',
    }]);
    assert.equal(state.unverified.length, 1);
    assert.deepEqual(state.enqueued, []);
    assert.equal(run.published[0]?.idempotencyKey, 'bing-webmaster-sync:2026-10-14:1');
    assert.equal(run.published[0]?.chain, 1);
    assert.equal(run.published[0]?.delaySeconds, 0);
    assert.equal(run.published[0]?.retentionSeconds, BING_QUEUE_RETENTION_SECONDS);
    await runBingQueueMessage(run.published[0], run);
    assert.deepEqual(state.replaces, []);
});

test('the worker writes traffic when queries fail and backs off without a snapshot on 429', async () => {
    const job: BingJob = {
        id: 'job-1', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/blog',
        leaseToken: 'lease-1', attempts: 0,
    };
    const traffic = [{ data_date: '2011-09-16', clicks: 4, impressions: 8 }];
    const pages = [{
        week_ending: '2011-09-16', page: 'https://example.test/a', clicks: 1, impressions: 2,
        avg_impression_position: null, avg_click_position: null,
    }];
    const first = memory({ job: { ...job } });
    const queryFail = deps(first.store, {
        readSite: async (): Promise<SiteReadOutcome> => ({ action: 'write', backoff: false, traffic, queries: null, pages }),
    });
    await runBingQueueMessage({ runId: RUN, chain: 1 }, queryFail);
    assert.equal(first.state.replaces.length, 1);
    assert.deepEqual(first.state.replaces[0], {
        organizationId: ORG,
        clientId: 'c1',
        siteUrl: 'https://example.test/blog',
        fetchedAt: NOW.toISOString(),
        traffic,
        queries: null,
        pages,
    });
    assert.deepEqual(first.state.synced, ['c1']);
    assert.equal(first.state.releases[0]?.resetAttempts, true);
    assert.equal(first.state.releases[0]?.status, 'idle');
    assert.equal(first.state.releases[0]?.availableAt, NOW.toISOString());
    assert.equal(queryFail.published[0]?.delaySeconds, BING_SITE_DELAY_SECONDS);
    assert.equal(queryFail.published[0]?.chain, 2);
    assert.equal(queryFail.published[0]?.idempotencyKey, `bing-webmaster-sync:${RUN}:2`);

    const second = memory({ job: { ...job } });
    const again = deps(second.store, {
        readSite: async () => ({ action: 'write', backoff: false, traffic, queries: null, pages }),
    });
    await runBingQueueMessage({ runId: RUN, chain: 2 }, again);
    assert.deepEqual(second.state.replaces[0], first.state.replaces[0]);

    const quota = memory({ job: { ...job } });
    const limited = deps(quota.store, { readSite: async () => ({ action: 'skip', backoff: true }) });
    await runBingQueueMessage({ runId: RUN, chain: 1 }, limited);
    assert.deepEqual(quota.state.replaces, []);
    assert.equal(quota.state.releases[0]?.status, 'pending');
    assert.equal(quota.state.releases[0]?.resetAttempts, false);
    assert.equal(quota.state.releases[0]?.availableAt, new Date(NOW.getTime() + bingBackoffSeconds(1) * 1000).toISOString());
    assert.equal(limited.published[0]?.delaySeconds, bingBackoffSeconds(1));

    const afterTraffic = memory({ job: { ...job } });
    const partial = deps(afterTraffic.store, {
        readSite: async () => ({ action: 'write', backoff: true, traffic, queries: null, pages: null }),
    });
    await runBingQueueMessage({ runId: RUN, chain: 1 }, partial);
    assert.equal(afterTraffic.state.replaces.length, 1);
    assert.equal(partial.published[0]?.delaySeconds, bingBackoffSeconds(1));
    assert.equal(afterTraffic.state.releases[0]?.resetAttempts, true);
});

test('a hard failure and a disallowed org do not write a snapshot', async () => {
    const job: BingJob = {
        id: 'job-1', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/',
        leaseToken: 'lease-1', attempts: 2,
    };
    const failed = memory({ job: { ...job } });
    const run = deps(failed.store, { readSite: async () => ({ action: 'fail' }) });
    await runBingQueueMessage({ runId: RUN, chain: 1 }, run);
    assert.deepEqual(failed.state.replaces, []);
    assert.deepEqual(failed.state.failed, ['c1']);
    assert.equal(failed.state.releases[0]?.status, 'idle');
    assert.equal(failed.state.releases[0]?.resetAttempts, false);
    assert.equal(
        failed.state.releases[0]?.availableAt,
        new Date(NOW.getTime() + BING_HARD_FAIL_DELAY_SECONDS * 1000).toISOString(),
    );
    assert.equal(run.published[0]?.delaySeconds, BING_SITE_DELAY_SECONDS);

    const foreign = memory({ job: { ...job, organizationId: OTHER } });
    const skipped = deps(foreign.store);
    await runBingQueueMessage({ runId: RUN, chain: 1 }, skipped);
    assert.deepEqual(foreign.state.replaces, []);
    assert.deepEqual(foreign.state.failed, []);
    assert.equal(foreign.state.releases[0]?.status, 'idle');
    assert.equal(
        foreign.state.releases[0]?.availableAt,
        new Date(NOW.getTime() + BING_PARK_SECONDS * 1000).toISOString(),
    );
});

test('queue messages stop at an empty claim, a bad payload, or the chain cap', async () => {
    const empty = memory();
    const run = deps(empty.store);
    await runBingQueueMessage({ runId: RUN, chain: 1 }, run);
    assert.deepEqual(run.published, []);
    await runBingQueueMessage({ runId: 'not-a-uuid', chain: 1 }, run);
    assert.deepEqual(empty.state.releases, []);
    const off = deps(empty.store, { env: env({}) });
    await runBingQueueMessage({ runId: RUN, chain: 1 }, off);
    assert.deepEqual(off.published, []);

    const capped = memory({
        job: {
            id: 'job-1', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/',
            leaseToken: 'lease-1', attempts: 0,
        },
    });
    const end = deps(capped.store, {
        readSite: async () => ({ action: 'write', backoff: false, traffic: [], queries: [], pages: [] }),
    });
    await runBingQueueMessage({ runId: RUN, chain: BING_CHAIN_LIMIT }, end);
    assert.equal(capped.state.replaces.length, 1);
    assert.equal(
        capped.state.releases[0]?.availableAt,
        new Date(NOW.getTime() + BING_RESYNC_COOLDOWN_SECONDS * 1000).toISOString(),
    );
    assert.deepEqual(end.published, []);
    assert.equal(parseBingQueueMessage({ runId: RUN, chain: BING_CHAIN_LIMIT + 1 }), null);
    assert.equal(bingBackoffSeconds(1), 15 * 60);
    assert.equal(bingBackoffSeconds(2), 30 * 60);
    assert.equal(bingBackoffSeconds(100), 6 * 60 * 60);
});

test('a storage error while saving becomes the fixed failure, not the driver message', async () => {
    const { store, state } = memory({
        job: {
            id: 'job-1', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/',
            leaseToken: 'lease-1', attempts: 1,
        },
    });
    store.replace = async () => { throw new Error(`driver failed apikey=${KEY}`); };
    const run = deps(store, {
        readSite: async () => ({ action: 'write', backoff: false, traffic: [], queries: [], pages: [] }),
    });
    await runBingQueueMessage({ runId: RUN, chain: 1 }, run);
    assert.deepEqual(state.failed, ['c1']);
    assert.deepEqual(state.synced, []);
    assert.equal(state.releases[0]?.status, 'idle');
});

test('an older snapshot is still a successful release', async () => {
    const { store, state } = memory({
        job: {
            id: 'job-1', organizationId: ORG, clientId: 'c1', siteUrl: 'https://example.test/',
            leaseToken: 'lease-1', attempts: 4,
        },
    });
    store.replace = async () => false;
    const run = deps(store, {
        readSite: async () => ({ action: 'write', backoff: false, traffic: [], queries: [], pages: [] }),
    });
    await runBingQueueMessage({ runId: RUN, chain: 1 }, run);
    assert.deepEqual(state.synced, ['c1']);
    assert.deepEqual(state.failed, []);
    assert.equal(state.releases[0]?.resetAttempts, true);
});

test('cron auth, the noon schedule, and the queue path are wired once', () => {
    assert.equal(cronAuthorized('Bearer secret', 'secret'), true);
    assert.equal(cronAuthorized('Bearer other', 'secret'), false);
    assert.equal(cronAuthorized('Bearer secret', ''), false);
    assert.equal(cronAuthorized(null, 'secret'), false);
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
        crons: { path: string; schedule: string }[];
        functions: Record<string, { maxDuration: number; experimentalTriggers: { type: string; topic: string }[] }>;
    };
    const crons = vercel.crons.filter(cron => cron.path === BING_CRON_PATH);
    assert.deepEqual(crons.map(cron => cron.schedule), [BING_CRON_SCHEDULE]);
    assert.equal(BING_CRON_SCHEDULE, '0 12 * * *');
    const trigger = vercel.functions['app/api/queues/bing-webmaster-sync/route.ts'].experimentalTriggers[0];
    assert.equal(trigger.type, 'queue/v2beta');
    assert.equal(trigger.topic, 'bing-webmaster-sync');
    assert.equal(vercel.functions['app/api/queues/bing-webmaster-sync/route.ts'].maxDuration, 300);
    const middleware = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
    assert.match(middleware, new RegExp(`pathname === '${BING_QUEUE_PATH}'`));
    const route = readFileSync(new URL('../../app/api/cron/sync-bing/route.ts', import.meta.url), 'utf8');
    assert.equal(route.includes('cronAuthorized'), true);
    assert.equal(route.includes('console.'), false);
    assert.equal(BING_UNVERIFIED_MESSAGE, 'Bing site is not verified');
});
