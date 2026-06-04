import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Upsert one month's metric row for a client+source.
 * Uses client_id + source + metric_month as the natural key.
 * source_type='auto' means it came from the sync engine.
 */
export async function upsertMetric(params: {
    organizationId: string;
    clientId: string;
    source: 'ga4' | 'gsc' | 'gbp' | 'ahrefs';
    metricMonth: string;   // 'YYYY-MM'
    data: Record<string, unknown>;
    syncRunId?: string;
    sourceType?: 'auto' | 'manual';
}): Promise<{ success: boolean; error?: string }> {
    const admin = createAdminClient();
    const { organizationId, clientId, source, metricMonth, data, syncRunId, sourceType = 'auto' } = params;

    try {
        // Check for existing row
        const { data: existing } = await admin
            .from('metrics')
            .select('id')
            .eq('client_id', clientId)
            .eq('source', source)
            .eq('metric_month', metricMonth)
            .maybeSingle();

        if (existing) {
            const { error } = await admin.from('metrics').update({
                data,
                source_type: sourceType,
                sync_run_id: syncRunId ?? null,
                date: `${metricMonth}-01`,
            }).eq('id', existing.id);
            if (error) throw error;
        } else {
            const { error } = await admin.from('metrics').insert({
                organization_id: organizationId,
                client_id: clientId,
                source,
                metric_month: metricMonth,
                source_type: sourceType,
                data,
                date: `${metricMonth}-01`,
                sync_run_id: syncRunId ?? null,
            });
            if (error) throw error;
        }
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** Fetch metric rows for a client, optionally filtered by month and/or source. */
export async function getClientMetrics(
    clientId: string,
    opts: { month?: string; source?: string } = {},
): Promise<{ source: string; metric_month: string; data: Record<string, any>; source_type: string }[]> {
    const admin = createAdminClient();
    let q = admin
        .from('metrics')
        .select('source, metric_month, data, source_type')
        .eq('client_id', clientId)
        .order('metric_month', { ascending: false });

    if (opts.month) q = q.eq('metric_month', opts.month);
    if (opts.source) q = q.eq('source', opts.source);

    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as any;
}
