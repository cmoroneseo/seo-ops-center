import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderManualClientIds, runBingManual } from './manual.ts';
import type { BingClientRow } from './match.ts';
import type { BingJob, BingRelease, BingRunDeps, BingStore, BingSyncRank } from './run.ts';
import { BING_RESYNC_COOLDOWN_SECONDS, type SiteReadOutcome } from './sync.ts';

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
    return { id, organizationId: ORG, domain, status: 'active', gscSiteUrl: null };
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
        async listSyncRanks() { return []; },
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

test('manual clicks move through every site, then wait out the cooldown', async () => {
    const ids = ['alpha', 'beta', 'delta', 'echo', 'gamma'];
    const clock = new Date('2026-10-14T12:00:00.000Z');
    const { deps, claimed, releases } = cooldownStore(ids, clock, () => written);
    const first = await runBingManual(ORG, deps, { siteLimit: 3 });
    const second = await runBingManual(ORG, deps, { siteLimit: 3 });
    const third = await runBingManual(ORG, deps, { siteLimit: 3 });
    assert.equal(first.sitesSynced, 3);
    assert.equal(second.sitesSynced, 2);
    assert.equal(third.sitesSynced, 0);
    assert.deepEqual(claimed, ['alpha', 'beta', 'delta', 'echo', 'gamma']);
    assert.equal(releases.length, 5);
    const cooled = new Date(clock.getTime() + BING_RESYNC_COOLDOWN_SECONDS * 1000).toISOString();
    assert.deepEqual(releases.map(release => release.availableAt), [cooled, cooled, cooled, cooled, cooled]);
});

test('an incomplete snapshot is retried ahead of a complete one', async () => {
    const clock = new Date('2026-10-14T12:00:00.000Z');
    const incomplete: SiteReadOutcome = { action: 'write', backoff: false, traffic: [], queries: null, pages: [] };
    const { deps, claimed, releases, expire } = cooldownStore(['broken', 'done'], clock, siteUrl => {
        return siteUrl === 'https://broken.example.test/' ? incomplete : written;
    });
    const first = await runBingManual(ORG, deps, { siteLimit: 2 });
    assert.equal(first.sitesSynced, 2);
    assert.deepEqual(claimed, ['broken', 'done']);
    assert.equal(releases[0]?.availableAt, clock.toISOString());
    assert.equal(releases[1]?.availableAt, new Date(clock.getTime() + BING_RESYNC_COOLDOWN_SECONDS * 1000).toISOString());
    expire('done');
    const second = await runBingManual(ORG, deps, { siteLimit: 1 });
    assert.equal(second.sitesSynced, 1);
    assert.deepEqual(claimed.slice(2), ['broken']);
});

test('manual order is never synced, then incomplete, then oldest complete', () => {
    const ranks: BingSyncRank[] = [
        { clientId: 'old', lastSyncedAt: '2026-10-10T00:00:00.000Z', complete: true },
        { clientId: 'older', lastSyncedAt: '2026-09-01T00:00:00.000Z', complete: true },
        { clientId: 'partial', lastSyncedAt: '2026-10-13T00:00:00.000Z', complete: false },
    ];
    assert.deepEqual(
        orderManualClientIds(['old', 'fresh', 'partial', 'older'], ranks),
        ['fresh', 'partial', 'older', 'old'],
    );
});

function cooldownStore(
    ids: string[],
    now: Date,
    readSite: (siteUrl: string) => SiteReadOutcome,
): { deps: BingRunDeps; claimed: string[]; releases: BingRelease[]; expire: (clientId: string) => void } {
    interface Row {
        status: 'pending' | 'idle' | 'running';
        availableAt: string;
        lastSyncedAt: string | null;
        complete: boolean;
        leaseToken: string;
    }
    const rows = new Map<string, Row>();
    const claimed: string[] = [];
    const releases: BingRelease[] = [];
    const clients = ids.map(id => client(id, `${id}.example.test`));
    const store: BingStore = {
        async listClients(organizationId) {
            return clients.filter(row => row.organizationId === organizationId);
        },
        async listIntegrations() { return []; },
        async listSyncRanks() {
            return [...rows.entries()].map(([clientId, row]): BingSyncRank => ({
                clientId,
                lastSyncedAt: row.lastSyncedAt,
                complete: row.complete,
            }));
        },
        async insertMapping() { return true; },
        async markUnverified() {},
        async enqueue(_organizationId, clientId) {
            const row = rows.get(clientId);
            if (!row) {
                rows.set(clientId, {
                    status: 'pending',
                    availableAt: now.toISOString(),
                    lastSyncedAt: null,
                    complete: true,
                    leaseToken: '',
                });
                return true;
            }
            if (row.status === 'idle' && row.availableAt <= now.toISOString()) {
                row.status = 'pending';
                row.availableAt = now.toISOString();
            }
            return true;
        },
        async claim(clientId) {
            if (!clientId) return null;
            const row = rows.get(clientId);
            if (!row || row.status !== 'pending' || row.availableAt > now.toISOString()) return null;
            row.status = 'running';
            row.leaseToken = `lease-${clientId}`;
            claimed.push(clientId);
            return job(clientId);
        },
        async release(input) {
            releases.push(input);
            const clientId = input.id.slice('job-'.length);
            const row = rows.get(clientId);
            if (!row || row.leaseToken !== input.leaseToken) return;
            row.status = input.status;
            row.availableAt = input.availableAt;
        },
        async replace(input) {
            const row = rows.get(input.clientId);
            if (row) row.complete = input.queries != null && input.pages != null;
            return true;
        },
        async markSynced(synced) {
            const row = rows.get(synced.clientId);
            if (row) row.lastSyncedAt = now.toISOString();
        },
        async markFailed() {},
    };
    const deps: BingRunDeps = {
        env: onEnv(),
        now: () => now,
        newRunId: () => '11111111-1111-4111-8111-111111111111',
        fetchSites: async () => ({
            d: clients.map(row => ({ Url: `https://${row.domain}/`, IsVerified: true })),
        }),
        readSite: async siteUrl => readSite(siteUrl),
        store,
        publish: async () => {},
    };
    return {
        deps,
        claimed,
        releases,
        expire(clientId: string) {
            const row = rows.get(clientId);
            if (!row) return;
            row.availableAt = now.toISOString();
            row.status = 'idle';
        },
    };
}
