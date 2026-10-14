import 'server-only';

import { agreementToday } from '@/lib/agreements/logic';
import type { ClientAgreement } from '@/lib/agreements/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseAgencyAggregate, parseTopQueries, QUERY_GAP_LABEL } from './aggregate';
import { dashboardManagerLabel } from './managers';
import { assembleDashboard, type DashboardClientInput, type DashboardModel } from './portfolio';
import { dashboardWindow, type DashboardRange } from './range';
import type { ManagerIdentity } from '@/lib/workspace/client-managers';

type DbError = { code?: string; message?: string } | null;
type Page<T> = { data: T[] | null; error: DbError };

const PAGE = 1000;

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return null;
}

function unavailable(error: DbError): boolean {
    const message = error?.message ?? '';
    return error?.code === '42883' || error?.code === 'PGRST202' || error?.code === '42P01' || /agency_dashboard_(as_of|gsc|top_queries)/.test(message);
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

function agreementFromRow(row: Record<string, unknown>): ClientAgreement {
    const date = (value: unknown) => text(value)?.slice(0, 10) ?? null;
    return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        clientId: String(row.client_id),
        previousId: row.previous_id ? String(row.previous_id) : null,
        kind: row.kind as ClientAgreement['kind'],
        title: text(row.title) ?? '',
        startsOn: date(row.starts_on) ?? '',
        endsOn: date(row.ends_on),
        mode: row.mode as ClientAgreement['mode'],
        hours: num(row.hours),
        hoursMode: (row.hours_mode as ClientAgreement['hoursMode']) ?? 'committed',
        proration: (row.proration as ClientAgreement['proration']) ?? 'daily',
        timezone: text(row.timezone) ?? 'UTC',
        scope: '',
        services: [],
        evidence: null,
        note: null,
        recordedAt: '',
        recordedBy: '',
        planSnapshot: null,
        cancelledAt: text(row.cancelled_at),
    };
}

function monthBounds(month: string): { start: string; end: string } {
    const [year, monthNumber] = month.split('-').map(Number);
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return { start: `${month}-01`, end: `${month}-${String(days).padStart(2, '0')}` };
}

export async function loadAgencyDashboard(
    organizationId: string,
    range: DashboardRange,
    now = new Date(),
): Promise<{ ok: true; dashboard: DashboardModel } | { ok: false; status: number; error: string }> {
    const admin = createAdminClient();
    const today = agreementToday('America/Los_Angeles', now);
    const hoursMonth = today.slice(0, 7);
    const bounds = monthBounds(hoursMonth);

    const [clients, integrations, agreements, timeLogs, membersResult] = await Promise.all([
        readAll<Record<string, unknown>>(span => admin.from('clients').select('id, name, domain, account_manager_id, account_manager_name, seo_hours').eq('organization_id', organizationId).eq('status', 'active').order('id').range(span, span + PAGE - 1)),
        readAll<Record<string, unknown>>(span => admin.from('client_integrations').select('client_id, sync_status, last_synced_at, site_url:credentials->>site_url').eq('organization_id', organizationId).eq('service', 'gsc').in('sync_status', ['active', 'error']).order('client_id').range(span, span + PAGE - 1)),
        readAll<Record<string, unknown>>(span => admin.from('client_agreements').select('id, organization_id, client_id, previous_id, kind, title, starts_on, ends_on, mode, hours, hours_mode, proration, timezone, cancelled_at').eq('organization_id', organizationId).order('id').range(span, span + PAGE - 1)),
        readAll<Record<string, unknown>>(span => admin.from('time_logs').select('id, client_id, hours').eq('organization_id', organizationId).eq('status', 'logged').eq('import_status', 'mapped').eq('counts_toward_budget', true).is('voided_at', null).gte('date', bounds.start).lte('date', bounds.end).order('id').range(span, span + PAGE - 1)),
        admin.from('organization_members').select('user_id, user:users(full_name, email)').eq('organization_id', organizationId),
    ]);

    if (clients.error || integrations.error) return { ok: false, status: 500, error: 'Could not load the dashboard.' };
    const agreementsMissing = agreements.error?.code === '42P01' || agreements.error?.code === 'PGRST205';
    if (agreements.error && !agreementsMissing) return { ok: false, status: 500, error: 'Could not load the dashboard.' };
    const hoursKnown = !timeLogs.error;

    const connected = new Map<string, { property: string; syncStatus: 'active' | 'error'; lastSyncedAt: string | null }>();
    for (const row of integrations.rows) {
        const clientId = text(row.client_id);
        const property = text(row.site_url);
        const syncStatus = row.sync_status === 'error' ? 'error' : row.sync_status === 'active' ? 'active' : null;
        if (!clientId || !property || !syncStatus) continue;
        connected.set(clientId, { property, syncStatus, lastSyncedAt: text(row.last_synced_at) });
    }

    const agreementsByClient = new Map<string, ClientAgreement[]>();
    if (!agreements.error) {
        for (const row of agreements.rows) {
            const agreement = agreementFromRow(row);
            const list = agreementsByClient.get(agreement.clientId) ?? [];
            list.push(agreement);
            agreementsByClient.set(agreement.clientId, list);
        }
    }
    const hoursByClient = new Map<string, number>();
    if (hoursKnown) {
        for (const row of timeLogs.rows) {
            const clientId = text(row.client_id);
            const hours = num(row.hours);
            if (!clientId || hours == null) continue;
            hoursByClient.set(clientId, (hoursByClient.get(clientId) ?? 0) + hours);
        }
    }

    const members = memberDirectory(membersResult.data);
    const inputClients: DashboardClientInput[] = clients.rows.flatMap(row => {
        const id = text(row.id);
        const link = id ? connected.get(id) : undefined;
        if (!id || !link) return [];
        return [{
            id,
            name: text(row.name) ?? 'Client',
            domain: text(row.domain),
            accountManager: dashboardManagerLabel(text(row.account_manager_name), text(row.account_manager_id), members),
            seoHours: num(row.seo_hours),
            property: link.property,
            syncStatus: link.syncStatus,
            lastSyncedAt: link.lastSyncedAt,
            loggedHours: hoursKnown ? (hoursByClient.get(id) ?? 0) : null,
            agreements: agreementsByClient.get(id) ?? [],
            // A missing agreements table is the pre-084 shape: fall back to seo_hours.
            agreementsKnown: true,
        }];
    });

    const asOfResult = await admin.rpc('agency_dashboard_as_of', { p_organization_id: organizationId });
    if (asOfResult.error) {
        if (unavailable(asOfResult.error)) return { ok: false, status: 503, error: 'Apply migration 090 before using the agency dashboard.' };
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
                today,
                hoursMonth,
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
        if (unavailable(aggregate.error)) return { ok: false, status: 503, error: 'Apply migration 090 before using the agency dashboard.' };
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
            today,
            hoursMonth,
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
        if (unavailable(asOfResult.error)) return { ok: false, status: 503, error: 'Apply migration 090 before using the agency dashboard.' };
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
        if (unavailable(result.error)) return { ok: false, status: 503, error: 'Apply migration 091 before loading top queries.' };
        return { ok: false, status: 500, error: 'Could not load queries.' };
    }
    try {
        const parsed = parseTopQueries(result.data);
        return { ok: true, queries: parsed.queries, reason: parsed.reason ? QUERY_GAP_LABEL[parsed.reason] : null };
    } catch {
        return { ok: false, status: 500, error: 'Could not load queries.' };
    }
}

function memberDirectory(rows: unknown): ManagerIdentity[] {
    if (!Array.isArray(rows)) return [];
    return rows.flatMap(row => {
        if (!row || typeof row !== 'object') return [];
        const record = row as Record<string, unknown>;
        const id = text(record.user_id);
        const user = Array.isArray(record.user) ? record.user[0] : record.user;
        const profile = user && typeof user === 'object' ? user as Record<string, unknown> : null;
        const name = text(profile?.full_name);
        if (!id || !name) return [];
        return [{ id, name, email: text(profile?.email) ?? undefined }];
    });
}
