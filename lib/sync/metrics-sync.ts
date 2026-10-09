import { createAdminClient } from '@/lib/supabase/admin';
import type { FetchResult, SyncService } from './fetch-result';
import { markIntegrationError, markIntegrationSynced } from './token';
import { writeMetric, type WriteMetricParams, type WriteOutcome } from './upsertMetric';
import { GoogleAuthError } from './token';

export type SourceOutcomeName =
    | WriteOutcome
    | 'no_data'
    | 'not_configured'
    | 'error'
    | 'skipped_time_budget';

export interface SourceOutcome {
    client_id: string;
    service: SyncService;
    outcome: SourceOutcomeName;
    message?: string;
}

export interface RunSummary {
    status: 'completed' | 'partial' | 'failed';
    clients_synced: number;
    clients_errored: number;
    clients_skipped: number;
    error_summary: { client_id: string; service: string; message: string }[];
    source_outcomes: SourceOutcome[];
}

export interface SyncStore {
    listOrgs(orgId?: string): Promise<{ id: string }[]>;
    reapStaleRuns(orgId: string, olderThanMinutes: number): Promise<number>;
    startRun(orgId: string, month: string, trigger: 'cron' | 'manual'): Promise<string>;
    listActiveClients(orgId: string, clientId?: string): Promise<{ id: string }[]>;
    writeMetric(params: WriteMetricParams): Promise<WriteOutcome>;
    markSynced(clientId: string, service: SyncService): Promise<void>;
    markError(clientId: string, service: SyncService, message: string): Promise<void>;
    finishRun(runId: string, summary: RunSummary): Promise<void>;
}

export interface SyncResponse {
    ok: true;
    month: string;
    months: string[];
    clients: number;
    sourcesUpdated: number;
    skippedManual: number;
    errors: number;
    errorDetail?: { clientId: string; service: string; message: string }[];
    skipped: number;
}

const SERVICES: SyncService[] = ['gsc', 'ga4', 'gbp', 'ahrefs'];
const SUCCESS = new Set<SourceOutcomeName>(['inserted', 'updated', 'skipped_manual', 'no_data']);

export interface MetricsSyncDeps {
    store: SyncStore;
    fetchers: Record<SyncService, (clientId: string, month: string) => Promise<FetchResult>>;
    now: () => number;
    budgetMs?: number;
    concurrency?: number;
    perSourceTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), ms);
        promise.then(
            value => { clearTimeout(timer); resolve(value); },
            error => { clearTimeout(timer); reject(error); },
        );
    });
}

async function settle(task: Promise<void>) {
    try { await task; } catch { /* a status write must not hide the source outcome */ }
}

function thrownOutcome(error: unknown): { message: string; retryable: boolean; reauth: boolean } {
    if (error instanceof GoogleAuthError) {
        return { message: error.message, retryable: error.kind === 'transient', reauth: error.kind === 'reauth_required' };
    }
    if (error instanceof Error && error.message === 'timed out') {
        return { message: 'timed out', retryable: true, reauth: false };
    }
    return { message: 'Sync failed', retryable: false, reauth: false };
}

export function summarizeOutcomes(outcomes: SourceOutcome[]): RunSummary {
    const hasError = outcomes.some(outcome => outcome.outcome === 'error');
    const hasSkip = outcomes.some(outcome => outcome.outcome === 'skipped_time_budget');
    const hasSuccess = outcomes.some(outcome => SUCCESS.has(outcome.outcome));
    const status = hasError && !hasSuccess ? 'failed' : (hasError || hasSkip) ? 'partial' : 'completed';
    const byClient = new Map<string, SourceOutcome[]>();
    for (const outcome of outcomes) {
        const list = byClient.get(outcome.client_id) ?? [];
        list.push(outcome);
        byClient.set(outcome.client_id, list);
    }
    let clientsSynced = 0;
    let clientsErrored = 0;
    let clientsSkipped = 0;
    for (const list of byClient.values()) {
        const errored = list.some(outcome => outcome.outcome === 'error');
        const skipped = list.some(outcome => outcome.outcome === 'skipped_time_budget');
        const success = list.some(outcome => SUCCESS.has(outcome.outcome));
        if (errored) clientsErrored += 1;
        if (skipped) clientsSkipped += 1;
        if (!errored && !skipped && success) clientsSynced += 1;
    }
    return {
        status,
        clients_synced: clientsSynced,
        clients_errored: clientsErrored,
        clients_skipped: clientsSkipped,
        error_summary: outcomes
            .filter(outcome => outcome.outcome === 'error')
            .map(outcome => ({ client_id: outcome.client_id, service: outcome.service, message: outcome.message ?? 'Sync failed' })),
        source_outcomes: outcomes,
    };
}

export async function runMetricsSync(
    scope: { organizationId?: string; clientId?: string; months: string[]; trigger: 'cron' | 'manual' },
    deps: MetricsSyncDeps,
): Promise<SyncResponse> {
    const budgetMs = deps.budgetMs ?? 240_000;
    const concurrency = Math.max(1, deps.concurrency ?? 4);
    const perSourceTimeoutMs = deps.perSourceTimeoutMs ?? 45_000;
    const started = deps.now();
    const orgs = await deps.store.listOrgs(scope.organizationId);
    let clients = 0;
    let sourcesUpdated = 0;
    let skippedManual = 0;
    let errors = 0;
    let skipped = 0;
    const errorDetail: { clientId: string; service: string; message: string }[] = [];

    for (const org of orgs) {
        await deps.store.reapStaleRuns(org.id, 15);
        for (const month of scope.months) {
            const runId = await deps.store.startRun(org.id, month, scope.trigger);
            let active: { id: string }[];
            try {
                active = await deps.store.listActiveClients(org.id, scope.clientId);
            } catch (error) {
                await deps.store.finishRun(runId, {
                    status: 'failed',
                    clients_synced: 0,
                    clients_errored: 0,
                    clients_skipped: 0,
                    error_summary: [{ client_id: '', service: 'runner', message: 'Unable to load clients' }],
                    source_outcomes: [],
                });
                throw error;
            }

            const outcomes: SourceOutcome[] = [];
            let cursor = 0;
            const runSource = async (clientId: string, service: SyncService): Promise<SourceOutcome> => {
                let result: FetchResult;
                try {
                    result = await withTimeout(deps.fetchers[service](clientId, month), perSourceTimeoutMs);
                } catch (error) {
                    const mapped = thrownOutcome(error);
                    if (!(mapped.retryable && !mapped.reauth)) {
                        await settle(deps.store.markError(clientId, service, mapped.message));
                    }
                    return { client_id: clientId, service, outcome: 'error', message: mapped.message };
                }
                if (result.status === 'ok') {
                    try {
                        const outcome = await deps.store.writeMetric({
                            organizationId: org.id,
                            clientId,
                            source: service,
                            metricMonth: month,
                            data: result.data,
                            sourceType: 'auto',
                            syncRunId: runId,
                            ...(result.provenance != null ? { provenance: result.provenance } : {}),
                        });
                        await settle(deps.store.markSynced(clientId, service));
                        return { client_id: clientId, service, outcome };
                    } catch {
                        return { client_id: clientId, service, outcome: 'error', message: 'Unable to save metrics' };
                    }
                }
                if (result.status === 'no_data') {
                    await settle(deps.store.markSynced(clientId, service));
                    return { client_id: clientId, service, outcome: 'no_data' };
                }
                if (result.status === 'not_configured') {
                    return { client_id: clientId, service, outcome: 'not_configured' };
                }
                if (!(result.retryable && !result.reauth)) {
                    await settle(deps.store.markError(clientId, service, result.message));
                }
                return { client_id: clientId, service, outcome: 'error', message: result.message };
            };

            const worker = async () => {
                for (;;) {
                    const overBudget = deps.now() - started > budgetMs;
                    const index = cursor++;
                    if (index >= active.length) return;
                    const client = active[index];
                    if (overBudget) {
                        for (const service of SERVICES) {
                            outcomes.push({ client_id: client.id, service, outcome: 'skipped_time_budget' });
                        }
                        continue;
                    }
                    for (const service of SERVICES) outcomes.push(await runSource(client.id, service));
                }
            };

            if (active.length > 0) {
                await Promise.all(Array.from({ length: Math.min(concurrency, active.length) }, () => worker()));
            }
            const summary = summarizeOutcomes(outcomes);
            await deps.store.finishRun(runId, summary);
            clients += active.length;
            sourcesUpdated += outcomes.filter(outcome => outcome.outcome === 'inserted' || outcome.outcome === 'updated').length;
            skippedManual += outcomes.filter(outcome => outcome.outcome === 'skipped_manual').length;
            errors += summary.error_summary.length;
            skipped += summary.clients_skipped;
            for (const outcome of summary.error_summary) {
                if (outcome.service === 'runner') continue;
                errorDetail.push({ clientId: outcome.client_id, service: outcome.service, message: outcome.message });
            }
        }
    }

    return {
        ok: true,
        month: scope.months[0] ?? '',
        months: scope.months,
        clients,
        sourcesUpdated,
        skippedManual,
        errors,
        errorDetail: errorDetail.length ? errorDetail : undefined,
        skipped,
    };
}

type Admin = ReturnType<typeof createAdminClient>;

/** Service-role store used by the metrics cron and the manual Sync button. */
export function createSupabaseSyncStore(admin: Admin = createAdminClient()): SyncStore {
    return {
        async listOrgs(orgId) {
            let query = admin.from('organizations').select('id').order('id');
            if (orgId) query = query.eq('id', orgId);
            const { data, error } = await query;
            if (error) throw new Error('Unable to load sync organizations');
            return data ?? [];
        },
        async reapStaleRuns(orgId, olderThanMinutes) {
            const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
            const { data, error } = await admin.from('sync_runs').update({
                status: 'failed',
                finished_at: new Date().toISOString(),
                error_summary: [{ service: 'runner', message: 'Run did not finish (timed out)' }],
            }).eq('organization_id', orgId).eq('status', 'running').lt('started_at', cutoff).select('id');
            if (error) throw new Error('Unable to close stale sync runs');
            return data?.length ?? 0;
        },
        async startRun(orgId, month, trigger) {
            const { data, error } = await admin.from('sync_runs').insert({
                organization_id: orgId,
                status: 'running',
                target_month: month,
                trigger,
            }).select('id').single();
            if (error || !data) throw new Error('Unable to start sync run');
            return data.id;
        },
        async listActiveClients(orgId, clientId) {
            let query = admin.from('clients').select('id').eq('organization_id', orgId).eq('status', 'active');
            if (clientId) query = query.eq('id', clientId);
            const { data, error } = await query;
            if (error) throw new Error('Unable to load sync clients');
            return data ?? [];
        },
        async writeMetric(params) {
            const result = await writeMetric(params);
            if (!result.success) throw new Error(result.error);
            return result.outcome;
        },
        markSynced: (clientId, service) => markIntegrationSynced(clientId, service),
        markError: (clientId, service, message) => markIntegrationError(clientId, service, message),
        async finishRun(runId, summary) {
            const { error } = await admin.from('sync_runs').update({
                status: summary.status,
                finished_at: new Date().toISOString(),
                clients_synced: summary.clients_synced,
                clients_errored: summary.clients_errored,
                clients_skipped: summary.clients_skipped,
                error_summary: summary.error_summary,
                source_outcomes: summary.source_outcomes,
            }).eq('id', runId);
            if (error) throw new Error('Unable to finish sync run');
        },
    };
}
