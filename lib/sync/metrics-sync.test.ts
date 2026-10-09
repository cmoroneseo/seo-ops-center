import test from 'node:test';
import assert from 'node:assert/strict';
import { runMetricsSync, type RunSummary, type SourceOutcome, type SyncStore } from './metrics-sync';
import { fetchError, notConfigured, ok, type FetchResult, type SyncService } from './fetch-result';
import { GoogleAuthError } from './token';

const SERVICES: SyncService[] = ['gsc', 'ga4', 'gbp', 'ahrefs'];

function memoryStore(clients: { id: string }[] = [{ id: 'c1' }]) {
    const calls: string[] = [];
    const finished: RunSummary[] = [];
    const marked: { kind: 'error' | 'synced'; service: string; message?: string }[] = [];
    let runs = 0;
    const store: SyncStore = {
        listOrgs: async () => [{ id: 'org' }],
        reapStaleRuns: async () => { calls.push('reap'); return 0; },
        startRun: async () => { calls.push('start'); runs += 1; return `run-${runs}`; },
        listActiveClients: async () => clients,
        writeMetric: async () => 'inserted',
        markSynced: async (_clientId, service) => { marked.push({ kind: 'synced', service }); },
        markError: async (_clientId, service, message) => { marked.push({ kind: 'error', service, message }); },
        finishRun: async (_runId, summary) => { finished.push(summary); },
    };
    return { store, calls, finished, marked };
}

function fetchers(map: Partial<Record<SyncService, () => Promise<FetchResult>>>): Record<SyncService, () => Promise<FetchResult>> {
    return {
        gsc: map.gsc ?? (async () => ok({ organic_clicks: 1 })),
        ga4: map.ga4 ?? (async () => ok({ sessions: 1 })),
        gbp: map.gbp ?? (async () => ok({ calls: 1 })),
        ahrefs: map.ahrefs ?? (async () => ok({ domain_rating: 1 })),
    };
}

async function run(store: SyncStore, sourceFetchers: Record<SyncService, (clientId: string, month: string) => Promise<FetchResult>>, extra?: Partial<Parameters<typeof runMetricsSync>[1]>) {
    return runMetricsSync(
        { organizationId: 'org', months: extra?.now ? ['2026-10'] : ['2026-10'], trigger: 'cron' },
        { store, fetchers: sourceFetchers, now: () => 0, budgetMs: 240_000, concurrency: 4, perSourceTimeoutMs: 45_000, ...extra },
    );
}

test('gsc provenance is forwarded and sources without it omit the field', async () => {
    const writes: { source: string; provenance?: Record<string, unknown> }[] = [];
    const memory = memoryStore();
    memory.store.writeMetric = async params => {
        writes.push({ source: params.source, provenance: params.provenance ?? undefined });
        return 'inserted';
    };
    await run(memory.store, fetchers({
        gsc: async () => ok({ organic_clicks: 4 }, { source: 'gsc_history', finality: { final: false, days_present: 9, days_expected: 31, complete_through: '2026-10-09' } }),
    }));
    assert.equal(writes.find(item => item.source === 'gsc')?.provenance?.source, 'gsc_history');
    assert.equal(writes.find(item => item.source === 'ga4')?.provenance, undefined);
});

test('one source error makes the run partial and marks only that source', async () => {
    const memory = memoryStore();
    const response = await run(memory.store, fetchers({
        gsc: async () => ok({ organic_clicks: 4 }),
        ga4: async () => fetchError('GA4 request failed (HTTP 400)', false),
        gbp: async () => notConfigured('Business Profile not connected'),
        ahrefs: async () => ok({ domain_rating: 20 }),
    }));
    const summary = memory.finished[0];
    assert.equal(summary.status, 'partial');
    assert.deepEqual(summary.error_summary.map(item => item.service), ['ga4']);
    assert.deepEqual(memory.marked.filter(item => item.kind === 'error').map(item => item.service), ['ga4']);
    assert.equal(response.errors, 1);
    assert.equal(response.sourcesUpdated, 2);
});

test('a client with nothing configured still completes the run', async () => {
    const memory = memoryStore();
    await run(memory.store, fetchers({
        gsc: async () => notConfigured('Search Console not connected'),
        ga4: async () => notConfigured('GA4 not connected'),
        gbp: async () => notConfigured('Business Profile not connected'),
        ahrefs: async () => notConfigured('Ahrefs not connected'),
    }));
    assert.equal(memory.finished[0].status, 'completed');
    assert.equal(memory.finished[0].clients_synced, 0);
    assert.deepEqual(memory.marked, []);
});

test('errors with no saved metrics fail the run', async () => {
    const memory = memoryStore();
    await run(memory.store, fetchers(Object.fromEntries(SERVICES.map(service => [service, async () => fetchError(`${service} down`, false)])) as Partial<Record<SyncService, () => Promise<FetchResult>>>));
    assert.equal(memory.finished[0].status, 'failed');
    assert.equal(memory.finished[0].clients_errored, 1);
    assert.equal(memory.marked.filter(item => item.kind === 'error').length, 4);
});

test('a protected manual row counts as a successful outcome', async () => {
    const memory = memoryStore();
    memory.store.writeMetric = async () => 'skipped_manual';
    const response = await run(memory.store, fetchers({}));
    assert.equal(memory.finished[0].status, 'completed');
    assert.equal(memory.finished[0].clients_synced, 1);
    assert.equal(response.skippedManual, 4);
    assert.equal(response.errors, 0);
});

test('clients past the time budget are skipped and the run is partial', async () => {
    const memory = memoryStore([{ id: 'c1' }, { id: 'c2' }]);
    const fetched: string[] = [];
    let tick = 0;
    const response = await runMetricsSync(
        { months: ['2026-10'], trigger: 'cron' },
        {
            store: memory.store,
            concurrency: 1,
            budgetMs: 1_000,
            now: () => {
                tick += 1;
                return tick === 1 ? 0 : tick === 2 ? 1 : 1_000_000;
            },
            fetchers: fetchers({
                gsc: async () => { fetched.push('gsc'); return ok({ organic_clicks: 1 }); },
                ga4: async () => { fetched.push('ga4'); return ok({ sessions: 1 }); },
                gbp: async () => { fetched.push('gbp'); return ok({ calls: 1 }); },
                ahrefs: async () => { fetched.push('ahrefs'); return ok({ domain_rating: 1 }); },
            }),
        },
    );
    assert.deepEqual(fetched, ['gsc', 'ga4', 'gbp', 'ahrefs']);
    const skipped = memory.finished[0].source_outcomes.filter(item => item.outcome === 'skipped_time_budget');
    assert.equal(skipped.length, 4);
    assert.equal(memory.finished[0].status, 'partial');
    assert.equal(memory.finished[0].clients_skipped, 1);
    assert.equal(response.skipped, 1);
});

test('a source timeout is an error and the later sources still run', async () => {
    const memory = memoryStore();
    const ran: string[] = [];
    await runMetricsSync(
        { months: ['2026-10'], trigger: 'manual' },
        {
            store: memory.store,
            now: () => 0,
            perSourceTimeoutMs: 20,
            fetchers: fetchers({
                gsc: () => new Promise<FetchResult>((_resolve, reject) => {
                    setTimeout(() => reject(new Error('late')), 200);
                }),
                ga4: async () => { ran.push('ga4'); return ok({ sessions: 2 }); },
                gbp: async () => { ran.push('gbp'); return ok({ calls: 2 }); },
                ahrefs: async () => { ran.push('ahrefs'); return ok({ domain_rating: 2 }); },
            }),
        },
    );
    const outcomes = memory.finished[0].source_outcomes;
    assert.equal(outcomes[0].outcome, 'error');
    assert.equal(outcomes[0].message, 'timed out');
    assert.deepEqual(ran, ['ga4', 'gbp', 'ahrefs']);
    assert.equal(memory.marked.some(item => item.kind === 'error'), false);
    assert.equal(memory.finished[0].status, 'partial');
});

test('a transient Google auth failure does not mark the integration', async () => {
    const memory = memoryStore();
    await run(memory.store, fetchers({
        gsc: async () => { throw new GoogleAuthError('Google token refresh failed (HTTP 503)', 'transient'); },
    }));
    assert.equal(memory.marked.some(item => item.kind === 'error'), false);
    assert.equal(memory.finished[0].source_outcomes[0].outcome, 'error');
    assert.equal(memory.finished[0].status, 'partial');
});

test('stale runs are closed before a new run starts', async () => {
    const memory = memoryStore();
    await run(memory.store, fetchers({}));
    assert.deepEqual(memory.calls.slice(0, 2), ['reap', 'start']);
});

test('each requested month gets its own run', async () => {
    const memory = memoryStore([]);
    const response = await runMetricsSync(
        { months: ['2026-11', '2026-10'], trigger: 'cron' },
        { store: memory.store, fetchers: fetchers({}), now: () => 0 },
    );
    assert.equal(memory.calls.filter(call => call === 'start').length, 2);
    assert.equal(memory.finished.length, 2);
    assert.deepEqual(response.months, ['2026-11', '2026-10']);
    assert.equal(memory.finished.every(summary => summary.status === 'completed'), true);
});

test('client concurrency stays inside the configured limit', async () => {
    const clients = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(id => ({ id }));
    const memory = memoryStore(clients);
    let inFlight = 0;
    let maxInFlight = 0;
    const pause = async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 15));
        inFlight -= 1;
        return ok({ organic_clicks: 1 });
    };
    await runMetricsSync(
        { months: ['2026-10'], trigger: 'cron' },
        {
            store: memory.store,
            concurrency: 2,
            now: () => 0,
            fetchers: fetchers({ gsc: pause, ga4: pause, gbp: pause, ahrefs: pause }),
        },
    );
    assert.ok(maxInFlight <= 2);
    assert.ok(maxInFlight >= 1);
    const outcomes = memory.finished[0].source_outcomes;
    assert.equal(outcomes.length, clients.length * SERVICES.length);
    assert.equal(outcomes.every((item: SourceOutcome) => item.outcome === 'inserted'), true);
});
