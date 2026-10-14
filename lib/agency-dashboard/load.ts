import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { parseAgencyAggregate, parseTopQueries, QUERY_GAP_LABEL } from './aggregate';
import { assembleDashboard, type DashboardClientInput, type DashboardModel } from './portfolio';
import { dashboardWindow, type DashboardRange } from './range';

type DbError = { code?: string; message?: string } | null;
type Page<T> = { data: T[] | null; error: DbError };

const PAGE = 1000;

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function unavailable(error: DbError): boolean {
    const message = error?.message ?? '';
    return error?.code === '42883' || error?.code === 'PGRST202' || error?.code === '42P01' || /agency_dashboard_(as_of|gsc|top_queries)/.test(message);
}

/** authenticator's 8s statement_timeout survives SET ROLE service_role. */
function statementTimeout(error: DbError): boolean {
    const message = error?.message ?? '';
    return error?.code === '57014' || /statement timeout|canceling statement/i.test(message);
}

function logDashboardError(scope: string, error: DbError): void {
    const code = statementTimeout(error) ? 'statement_timeout' : (error?.code ?? 'unknown');
    console.error(`[agency-dashboard] ${scope} failed`, code);
}

async function readAll<T>(query: (from: number, to: number) => PromiseLike<Page<T>>): Promise<{ rows: T[]; error: DbError }> {
    const rows: T[] = [];
    for (let from = 0; from < 20000; from += PAGE) {
        const page = await query(from, from + PAGE - 1);
        if (page.error) return { rows: [], error: page.error };
        const data = page.data ?? [];
        rows.push(...data);
        if (data.length < PAGE) return { rows, error: null };
    }
    return { rows: [], error: { code: 'limit' } };
}

export async function loadAgencyDashboard(
    organizationId: string,
    range: DashboardRange,
): Promise<{ ok: true; dashboard: DashboardModel } | { ok: false; status: number; error: string }> {
    const admin = createAdminClient();

    const [clients, integrations] = await Promise.all([
        readAll<Record<string, unknown>>(span => admin.from('clients').select('id, name, domain').eq('organization_id', organizationId).eq('status', 'active').order('id').range(span, span + PAGE - 1)),
        readAll<Record<string, unknown>>(span => admin.from('client_integrations').select('client_id, sync_status, last_synced_at, site_url:credentials->>site_url').eq('organization_id', organizationId).eq('service', 'gsc').in('sync_status', ['active', 'error']).order('client_id').range(span, span + PAGE - 1)),
    ]);

    if (clients.error || integrations.error) {
        logDashboardError('clients', clients.error ?? integrations.error);
        return { ok: false, status: 500, error: 'Could not load the dashboard.' };
    }

    const connected = new Map<string, { property: string; syncStatus: 'active' | 'error'; lastSyncedAt: string | null }>();
    for (const row of integrations.rows) {
        const clientId = text(row.client_id);
        const property = text(row.site_url);
        const syncStatus = row.sync_status === 'error' ? 'error' : row.sync_status === 'active' ? 'active' : null;
        if (!clientId || !property || !syncStatus) continue;
        connected.set(clientId, { property, syncStatus, lastSyncedAt: text(row.last_synced_at) });
    }

    const inputClients: DashboardClientInput[] = clients.rows.flatMap(row => {
        const id = text(row.id);
        const link = id ? connected.get(id) : undefined;
        if (!id || !link) return [];
        return [{
            id,
            name: text(row.name) ?? 'Client',
            domain: text(row.domain),
            property: link.property,
            syncStatus: link.syncStatus,
            lastSyncedAt: link.lastSyncedAt,
        }];
    });

    const asOfResult = await admin.rpc('agency_dashboard_as_of', { p_organization_id: organizationId });
    if (asOfResult.error) {
        logDashboardError('as-of', asOfResult.error);
        if (unavailable(asOfResult.error)) return { ok: false, status: 503, error: 'Apply migration 090 before using the agency dashboard.' };
        if (statementTimeout(asOfResult.error)) return { ok: false, status: 503, error: 'The dashboard took too long to load.' };
        return { ok: false, status: 500, error: 'Could not load the dashboard.' };
    }
    const asOf = text(asOfResult.data)?.slice(0, 10) ?? (asOfResult.data instanceof Date ? asOfResult.data.toISOString().slice(0, 10) : null);
    if (!asOf) {
        return {
            ok: true,
            dashboard: assembleDashboard({
                range,
                window: null,
                asOf: null,
                clients: inputClients,
                aggregates: [],
                freshness: { latestDataDate: null, latestImportedAt: null, settling: false },
            }),
        };
    }

    const window = dashboardWindow(range, asOf);
    const aggregate = await admin.rpc('agency_dashboard_gsc', {
        p_organization_id: organizationId,
        p_current_start: window.current.start,
        p_current_end: window.current.end,
        p_previous_start: window.previous.start,
        p_previous_end: window.previous.end,
        p_bucket: window.bucket,
    });
    if (aggregate.error) {
        logDashboardError('portfolio', aggregate.error);
        if (unavailable(aggregate.error)) return { ok: false, status: 503, error: 'Apply migration 090 before using the agency dashboard.' };
        if (statementTimeout(aggregate.error)) return { ok: false, status: 503, error: 'The dashboard took too long to load.' };
        return { ok: false, status: 500, error: 'Could not load the dashboard.' };
    }

    let parsed;
    try {
        parsed = parseAgencyAggregate(aggregate.data);
    } catch {
        return { ok: false, status: 500, error: 'Could not load the dashboard.' };
    }

    return {
        ok: true,
        dashboard: assembleDashboard({
            range,
            window,
            asOf,
            clients: inputClients,
            aggregates: parsed.clients,
            freshness: parsed.freshness,
        }),
    };
}

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadTopQueries(
    organizationId: string,
    clientId: string,
    range: DashboardRange,
): Promise<{ ok: true; queries: Array<{ query: string; clicks: number }>; reason: string | null } | { ok: false; status: number; error: string }> {
    if (!CLIENT_ID.test(clientId)) return { ok: false, status: 400, error: 'Choose a client.' };
    const admin = createAdminClient();
    const asOfResult = await admin.rpc('agency_dashboard_as_of', { p_organization_id: organizationId });
    if (asOfResult.error) {
        logDashboardError('queries-as-of', asOfResult.error);
        if (unavailable(asOfResult.error)) return { ok: false, status: 503, error: 'Apply migration 090 before loading top queries.' };
        if (statementTimeout(asOfResult.error)) return { ok: false, status: 503, error: 'Top queries took too long to load.' };
        return { ok: false, status: 500, error: 'Could not load queries.' };
    }
    const asOf = text(asOfResult.data)?.slice(0, 10) ?? (asOfResult.data instanceof Date ? asOfResult.data.toISOString().slice(0, 10) : null);
    if (!asOf) return { ok: true, queries: [], reason: QUERY_GAP_LABEL.not_stored };
    const window = dashboardWindow(range, asOf);
    const result = await admin.rpc('agency_dashboard_top_queries', {
        p_organization_id: organizationId,
        p_client_id: clientId,
        p_start: window.current.start,
        p_end: window.current.end,
    });
    if (result.error) {
        logDashboardError('queries', result.error);
        if (unavailable(result.error)) return { ok: false, status: 503, error: 'Apply migration 091 before loading top queries.' };
        if (statementTimeout(result.error)) return { ok: false, status: 503, error: 'Top queries took too long to load.' };
        return { ok: false, status: 500, error: 'Could not load queries.' };
    }
    try {
        const parsed = parseTopQueries(result.data);
        return { ok: true, queries: parsed.queries, reason: parsed.reason ? QUERY_GAP_LABEL[parsed.reason] : null };
    } catch {
        return { ok: false, status: 500, error: 'Could not load queries.' };
    }
}
