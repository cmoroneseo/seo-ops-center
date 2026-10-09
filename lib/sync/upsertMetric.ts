import { createAdminClient } from '@/lib/supabase/admin';

export type MetricSource = 'ga4' | 'gsc' | 'gbp' | 'ahrefs';
export type WriteOutcome = 'inserted' | 'updated' | 'skipped_manual';

export interface WriteMetricParams {
    organizationId: string;
    clientId: string;
    source: MetricSource;
    metricMonth: string;
    data: Record<string, unknown>;
    sourceType: 'auto' | 'manual';
    syncRunId?: string | null;
    enteredBy?: string | null;
    /** Sent only when present, so older write_metric (before 074) still accepts other sources. */
    provenance?: Record<string, unknown> | null;
}

export interface MetricRow {
    source: string;
    metric_month: string;
    data: Record<string, unknown>;
    source_type: string;
    updated_at: string | null;
}

type RpcClient = {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
    from: (table: string) => MetricQuery;
};

interface MetricQuery {
    select: (columns: string) => MetricQuery;
    eq: (column: string, value: string) => MetricQuery;
    order: (column: string, options: { ascending: boolean }) => MetricQuery;
    delete: () => MetricQuery;
    then?: unknown;
}

const genericWriteError = 'Unable to save metrics';

function adminClient(): RpcClient {
    return createAdminClient() as unknown as RpcClient;
}

/** Write one month through the service-only RPC. Manual rows are never downgraded to auto. */
export async function writeMetric(
    params: WriteMetricParams,
    deps: { admin: () => RpcClient } = { admin: adminClient },
): Promise<{ success: true; outcome: WriteOutcome } | { success: false; error: string }> {
    try {
        const args: Record<string, unknown> = {
            p_organization_id: params.organizationId,
            p_client_id: params.clientId,
            p_source: params.source,
            p_metric_month: params.metricMonth,
            p_data: params.data,
            p_source_type: params.sourceType,
            p_sync_run_id: params.syncRunId ?? null,
            p_entered_by: params.enteredBy ?? null,
        };
        if (params.provenance != null) args.p_provenance = params.provenance;
        const { data, error } = await deps.admin().rpc('write_metric', args);
        if (error) return { success: false, error: genericWriteError };
        if (data !== 'inserted' && data !== 'updated' && data !== 'skipped_manual') {
            return { success: false, error: genericWriteError };
        }
        return { success: true, outcome: data };
    } catch {
        return { success: false, error: genericWriteError };
    }
}

/** Alias kept for callers that still say "upsert". Automatic sync is the default. */
export async function upsertMetric(
    params: Omit<WriteMetricParams, 'sourceType'> & { sourceType?: 'auto' | 'manual' },
    deps?: { admin: () => RpcClient },
): Promise<{ success: boolean; error?: string; outcome?: WriteOutcome }> {
    const result = await writeMetric({ ...params, sourceType: params.sourceType ?? 'auto' }, deps);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, outcome: result.outcome };
}

/** Metric rows for one client inside one organization. */
export async function getClientMetrics(
    clientId: string,
    opts: { organizationId: string; month?: string; source?: string },
    deps: { admin: () => RpcClient } = { admin: adminClient },
): Promise<MetricRow[]> {
    let query = deps.admin()
        .from('metrics')
        .select('source, metric_month, data, source_type, updated_at')
        .eq('client_id', clientId)
        .eq('organization_id', opts.organizationId)
        .order('metric_month', { ascending: false });
    if (opts.month) query = query.eq('metric_month', opts.month);
    if (opts.source) query = query.eq('source', opts.source);
    const { data, error } = await (query as unknown as Promise<{ data: MetricRow[] | null; error: { message?: string } | null }>);
    if (error) return [];
    return data ?? [];
}

/** Remove a manual row so the next sync can fill it. Synced rows are left alone. */
export async function deleteManualMetric(
    params: { clientId: string; organizationId: string; source: string; metricMonth: string },
    deps: { admin: () => RpcClient } = { admin: adminClient },
): Promise<'deleted' | 'not_found'> {
    const query = deps.admin()
        .from('metrics')
        .delete()
        .eq('client_id', params.clientId)
        .eq('organization_id', params.organizationId)
        .eq('source', params.source)
        .eq('metric_month', params.metricMonth)
        .eq('source_type', 'manual')
        .select('id');
    const { data, error } = await (query as unknown as Promise<{ data: { id: string }[] | null; error: { message?: string } | null }>);
    if (error || !data?.length) return 'not_found';
    return 'deleted';
}
