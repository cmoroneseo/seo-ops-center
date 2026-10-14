import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBingManual } from './manual.ts';
import type { BingClientRow } from './match.ts';
import type { BingJob, BingRunDeps, BingStore } from './run.ts';
import type { SiteReadOutcome } from './sync.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const KEY = 'synthetic-bing-key';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

function onEnv(orgs = ORG): NodeJS.ProcessEnv {
    return env({ BING_WEBMASTER: 'true', BING_WEBMASTER_ORG_IDS: orgs, BING_WEBMASTER_API_KEY: KEY });
}

function client(id: string, domain: string): BingClientRow {
    return { id, organizationId: ORG, domain, status: 'active' };
}

function job(clientId: string, organizationId = ORG): BingJob {
    return {
        id: `job-${clientId}`,
        organizationId,
        clientId,
        siteUrl: `https://${clientId}.example.test/`,
        leaseToken: `lease-${clientId}`,
        attempts: 1,
    };
}

const written: SiteReadOutcome = {
    action: 'write',
    backoff: false,
    traffic: [],
    queries: [],
    pages: [],
};

interface Harness {
    deps: BingRunDeps;
    fetched: () => number;
    published: number;
    claimed: Array<string | null | undefined>;
    replaced: string[];
    unverified: number;
    listed: string[];
}

function harness(options: {
    clients?: BingClientRow[];
    jobs?: Record<string, BingJob | null>;
    outcomes?: SiteReadOutcome[];
    env?: NodeJS.ProcessEnv;
    fetchSites?: () => Promise<unknown>;
} = {}): Harness {
    const clients = options.clients ?? [client('alpha', 'alpha.example.test'), client('beta', 'beta.example.test')];
    const calls = { fetched: 0, published: 0, unverified: 0 };
    const claimed: Array<string | null | undefined> = [];
    const replaced: string[] = [];
    const listed: string[] = [];
    let outcomeIndex = 0;
    const outcomes = options.outcomes ?? [written, written];
    const store: BingStore = {
        async listClients(organizationId) {
            listed.push(organizationId);
            return clients.filter(row => row.organizationId === organizationId);
        },
        async listIntegrations() { return []; },
        async insertMapping() { return true; },
        async markUnverified() { calls.unverified += 1; },
        async enqueue(_organizationId, clientId) { return Boolean(clientId); },
        async claim(clientId) {
            claimed.push(clientId);
            if (options.jobs && clientId && clientId in options.jobs) return options.jobs[clientId] ?? null;
            return clientId ? job(clientId) : null;
        },
        async release() {},
        async replace(input) {
            replaced.push(input.clientId);
            return true;
        },
        async markSynced() {},
        async markFailed() {},
    };
    const deps: BingRunDeps = {
        env: options.env ?? onEnv(),
        now: () => new Date('2026-10-14T12:00:00.000Z'),
        newRunId: () => '11111111-1111-4111-8111-111111111111',
        fetchSites: options.fetchSites ?? (async () => {
            calls.fetched += 1;
            return {
                d: clients.map(row => ({ Url: `https://${row.domain}/`, IsVerified: true })),
            };
        }),
        readSite: async () => outcomes[outcomeIndex++] ?? { action: 'fail' },
        store,
        publish: async () => { calls.published += 1; },
    };
    return {
        deps,
        fetched: () => calls.fetched,
        get published() { return calls.published; },
        claimed,
        replaced,
        get unverified() { return calls.unverified; },
        listed,
    };
}

test('a manual run stays quiet when this org is not allowlisted', async () => {
    const run = harness({ env: onEnv(OTHER) });
    assert.deepEqual(await runBingManual(ORG, run.deps), {
        sitesMapped: 0, sitesSynced: 0, remaining: 0, errors: [], skipped: 'flag_off',
    });
    assert.equal(run.fetched(), 0);
    assert.equal(run.published, 0);
    assert.equal(run.unverified, 0);
    assert.deepEqual(run.listed, []);
});

test('a missing key does not fetch sites', async () => {
    const run = harness({
        env: env({ BING_WEBMASTER: 'true', BING_WEBMASTER_ORG_IDS: ORG }),
    });
    assert.deepEqual(await runBingManual(ORG, run.deps), {
        sitesMapped: 0, sitesSynced: 0, remaining: 0, errors: [], skipped: 'missing_key',
    });
    assert.equal(run.fetched(), 0);
    assert.equal(run.published, 0);
});

test('a thrown site list does not mark clients unverified', async () => {
    const run = harness({
        fetchSites: async () => { throw new Error(`apikey=${KEY}`); },
    });
    assert.deepEqual(await runBingManual(ORG, run.deps), {
        sitesMapped: 0, sitesSynced: 0, remaining: 0, errors: [], skipped: 'unavailable',
    });
    assert.equal(run.unverified, 0);
    assert.equal(run.published, 0);
    assert.deepEqual(run.replaced, []);
});

test('one click maps this org, syncs a few sites, and does not publish', async () => {
    const run = harness({ env: onEnv(`${ORG},${OTHER}`) });
    assert.deepEqual(await runBingManual(ORG, run.deps, { siteLimit: 1 }), {
        sitesMapped: 2, sitesSynced: 1, remaining: 1, errors: [], skipped: null,
    });
    assert.deepEqual(run.listed, [ORG]);
    assert.deepEqual(run.claimed, ['alpha']);
    assert.deepEqual(run.replaced, ['alpha']);
    assert.equal(run.published, 0);
});

test('429 stops the rest of the click and reports only the status code', async () => {
    const run = harness({
        outcomes: [{ action: 'skip', backoff: true, status: 429 }, written],
    });
    assert.deepEqual(await runBingManual(ORG, run.deps), {
        sitesMapped: 2, sitesSynced: 0, remaining: 1, errors: [429], skipped: null,
    });
    assert.deepEqual(run.claimed, ['alpha']);
    assert.deepEqual(run.replaced, []);
    assert.equal(run.published, 0);
});

test('a claimed job for another org is not written', async () => {
    const run = harness({
        clients: [client('alpha', 'alpha.example.test')],
        jobs: { alpha: job('alpha', OTHER) },
    });
    assert.deepEqual(await runBingManual(ORG, run.deps), {
        sitesMapped: 1, sitesSynced: 0, remaining: 0, errors: [], skipped: null,
    });
    assert.deepEqual(run.replaced, []);
    assert.equal(run.published, 0);
});

test('the time budget stops before the next site', async () => {
    let ticks = 0;
    const run = harness();
    const result = await runBingManual(ORG, run.deps, {
        clock: () => {
            ticks += 1;
            return ticks <= 2 ? 0 : 30_000;
        },
    });
    assert.deepEqual(result, {
        sitesMapped: 2, sitesSynced: 1, remaining: 1, errors: [], skipped: null,
    });
    assert.deepEqual(run.claimed, ['alpha']);
});

test('the manual route and the cron route log a summary without the key', () => {
    const route = readFileSync(new URL('../../app/api/integrations/bing/sync/route.ts', import.meta.url), 'utf8');
    const cron = readFileSync(new URL('../../app/api/cron/sync-bing/route.ts', import.meta.url), 'utf8');
    const middleware = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../../app/(dashboard)/settings/page.tsx', import.meta.url), 'utf8');
    const dashboard = readFileSync(new URL('../../components/agency-dashboard/AgencyDashboard.tsx', import.meta.url), 'utf8');
    assert.match(route, /requireOrganizationAdmin/);
    assert.match(route, /logBingSyncSummary/);
    assert.match(route, /SELECTED_ORG_COOKIE/);
    assert.equal(route.split('console.').length, 1);
    assert.equal(route.split('BING_WEBMASTER_API_KEY').length, 1);
    const body = route.slice(route.indexOf('async function runForOrganization'));
    const enabledAt = body.indexOf('bingWebmasterEnabled');
    const keyAt = body.indexOf('bingWebmasterApiKey');
    const adminAt = body.indexOf('createAdminClient()');
    assert.equal(enabledAt !== -1 && keyAt !== -1 && enabledAt < adminAt && keyAt < adminAt, true);
    const cronGate = cron.indexOf('if (!cronAuthorized');
    const cronLog = cron.indexOf('logBingSyncSummary(summarizeBingCron');
    assert.equal(cronGate !== -1 && cronLog !== -1 && cronGate < cronLog, true);
    assert.equal(cron.split('console.').length, 1);
    assert.doesNotMatch(middleware, /\/api\/integrations\/bing/);
    assert.match(settings, /SyncBingButton/);
    assert.match(settings, /role === 'owner' \|\| role === 'admin'/);
    assert.match(dashboard, /SyncBingButton variant="toolbar"/);
    assert.match(dashboard, /canSyncBing=\{role === 'owner' \|\| role === 'admin'\}/);
});
