import 'server-only';

import { bingWebmasterEnabled } from '@/lib/bing/flags';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseAgencyAggregate, parseTopQueries, QUERY_GAP_LABEL } from './aggregate';
import { ga4CardsEnabled } from './ga4-flag';
import {
    attachGa4Dashboard,
    EMPTY_GA4_AGGREGATE,
    GA4_PROPERTY_ID,
    parseGa4Aggregate,
    type Ga4Aggregate,
    type Ga4AttachInput,
} from './ga4';
import {
    attachBingDashboard,
    BING_LINK_COLUMNS,
    BING_PAGE_COLUMNS,
    EMPTY_BING_PAYLOAD,
    readBingLink,
    readBingPageRow,
    type BingAttachInput,
    type BingLinkInput,
    type BingPageSource,
} from './bing';
import { assembleDashboard, type DashboardClientInput, type DashboardModel } from './portfolio';
import { dashboardWindow, daysInclusive, type DashboardRange, type DashboardWindow } from './range';

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

    const [clients, integrations, asOfResult] = await Promise.all([
        readAll<Record<string, unknown>>(span => admin.from('clients').select('id, name, domain').eq('organization_id', organizationId).eq('status', 'active').order('id').range(span, span + PAGE - 1)),
        readAll<Record<string, unknown>>(span => admin.from('client_integrations').select('client_id, sync_status, last_synced_at, site_url:credentials->>site_url').eq('organization_id', organizationId).eq('service', 'gsc').in('sync_status', ['active', 'error']).order('client_id').range(span, span + PAGE - 1)),
        admin.rpc('agency_dashboard_as_of', { p_organization_id: organizationId }),
    ]);

    if (clients.error || integrations.error) return { ok: false, status: 500, error: 'Could not load the dashboard.' };

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

    if (asOfResult.error) {
        if (unavailable(asOfResult.error)) return { ok: false, status: 503, error: 'Apply migration 090 before using the agency dashboard.' };
        return { ok: false, status: 500, error: 'Could not load the dashboard.' };
    }
    const asOf = text(asOfResult.data)?.slice(0, 10) ?? (asOfResult.data instanceof Date ? asOfResult.data.toISOString().slice(0, 10) : null);
    if (!asOf) {
        const dashboard = assembleDashboard({
            range,
            window: null,
            asOf: null,
            clients: inputClients,
            aggregates: [],
            freshness: { latestDataDate: null, latestImportedAt: null, settling: false },
        });
        return { ok: true, dashboard: await finish(admin, organizationId, null, dashboard) };
    }

    const window = dashboardWindow(range, asOf);
    // Bing and GA4 do not need the Search Console aggregate. Start them now so
    // they share this wave instead of waiting until GSC returns.
    const bingPromise = loadBingInput(admin, organizationId, window);
    const ga4Promise = loadGa4Input(admin, organizationId, window);
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

    const dashboard = assembleDashboard({
        range,
        window,
        asOf,
        clients: inputClients,
        aggregates: parsed.clients,
        freshness: parsed.freshness,
    });
    const [bing, ga4] = await Promise.all([bingPromise, ga4Promise]);
    return { ok: true, dashboard: applySideSources(dashboard, bing, ga4) };
}

function applySideSources(dashboard: DashboardModel, bing: BingAttachInput | null, ga4: Ga4AttachInput | null): DashboardModel {
    const withBing = bing ? attachBingDashboard(dashboard, bing) : dashboard;
    return ga4 ? attachGa4Dashboard(withBing, ga4) : withBing;
}

async function finish(admin: Admin, organizationId: string, window: DashboardWindow | null, dashboard: DashboardModel): Promise<DashboardModel> {
    const [bing, ga4] = await Promise.all([
        loadBingInput(admin, organizationId, window),
        loadGa4Input(admin, organizationId, window),
    ]);
    return applySideSources(dashboard, bing, ga4);
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Bing is optional. A failed read leaves the Google dashboard up and says why
 * on the Bing side. The driver error stays off the response.
 */
async function loadBingInput(admin: Admin, organizationId: string, window: DashboardWindow | null): Promise<BingAttachInput | null> {
    if (!bingWebmasterEnabled(process.env, organizationId)) return null;
    const bucket = window?.bucket ?? 'day';
    const expectedDays = window ? daysInclusive(window.current.start, window.current.end) : 0;
    const expectedPreviousDays = window ? daysInclusive(window.previous.start, window.previous.end) : 0;
    const base = { bucket, expectedDays, expectedPreviousDays };
    try {
        if (!window) {
            const links = await readBingLinks(admin, organizationId);
            if (!links.ok) return { ...base, failed: true };
            return { ...base, links: links.links, payload: EMPTY_BING_PAYLOAD, pages: [] };
        }
        const [links, aggregate, pages] = await Promise.all([
            readBingLinks(admin, organizationId),
            admin.rpc('agency_dashboard_bing', {
                p_organization_id: organizationId,
                p_current_start: window.current.start,
                p_current_end: window.current.end,
                p_previous_start: window.previous.start,
                p_previous_end: window.previous.end,
                p_bucket: window.bucket,
            }),
            readBingPages(admin, organizationId, window.current.start, window.current.end),
        ]);
        if (!links.ok || aggregate.error) return { ...base, failed: true };
        return {
            ...base,
            links: links.links,
            payload: aggregate.data,
            pages: pages.ok ? pages.rows : [],
            pagesFailed: !pages.ok,
        };
    } catch {
        return { ...base, failed: true };
    }
}

/**
 * GA4 is optional. A failed read leaves the Search Console cards up.
 * Mapped clients show an em dash. Unmapped clients still offer Connect GA4.
 * The driver error stays off the response.
 */
async function loadGa4Input(admin: Admin, organizationId: string, window: DashboardWindow | null): Promise<Ga4AttachInput | null> {
    if (!ga4CardsEnabled(process.env)) return null;
    const expectedPreviousDays = window ? daysInclusive(window.previous.start, window.previous.end) : 0;
    try {
        if (!window) {
            const links = await readGa4Links(admin, organizationId);
            if (!links.ok) return { links: null, aggregate: null, expectedPreviousDays };
            return { links: links.links, aggregate: EMPTY_GA4_AGGREGATE, expectedPreviousDays };
        }
        const [links, aggregate] = await Promise.all([
            readGa4Links(admin, organizationId),
            admin.rpc('agency_dashboard_ga4', {
                p_organization_id: organizationId,
                p_current_start: window.current.start,
                p_current_end: window.current.end,
                p_previous_start: window.previous.start,
                p_previous_end: window.previous.end,
                p_bucket: window.bucket,
            }),
        ]);
        if (!links.ok) return { links: null, aggregate: null, expectedPreviousDays };
        let parsed: Ga4Aggregate | null = null;
        if (!aggregate.error) {
            try {
                parsed = parseGa4Aggregate(aggregate.data);
            } catch {
                parsed = null;
            }
        }
        return { links: links.links, aggregate: parsed, expectedPreviousDays };
    } catch {
        return { links: null, aggregate: null, expectedPreviousDays };
    }
}

async function readGa4Links(admin: Admin, organizationId: string): Promise<{ ok: true; links: Array<{ clientId: string; property: string }> } | { ok: false }> {
    const result = await readAll<Record<string, unknown>>(span => admin
        .from('client_integrations')
        .select('client_id, property_id:credentials->>property_id')
        .eq('organization_id', organizationId)
        .eq('service', 'ga4')
        .in('sync_status', ['active', 'error'])
        .order('client_id')
        .range(span, span + PAGE - 1));
    if (result.error) return { ok: false };
    const links: Array<{ clientId: string; property: string }> = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
        const clientId = text(row.client_id);
        const property = text(row.property_id);
        if (!clientId || !property || !GA4_PROPERTY_ID.test(property) || seen.has(clientId)) continue;
        seen.add(clientId);
        links.push({ clientId, property });
    }
    return { ok: true, links };
}

async function readBingLinks(admin: Admin, organizationId: string): Promise<{ ok: true; links: BingLinkInput[] } | { ok: false }> {
    const result = await readAll<Record<string, unknown>>(span => admin
        .from('client_integrations')
        .select(BING_LINK_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('service', 'bing')
        .in('sync_status', ['active', 'error'])
        .order('client_id')
        .range(span, span + PAGE - 1));
    if (result.error) return { ok: false };
    const links: BingLinkInput[] = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
        const link = readBingLink(row);
        if (!link || seen.has(link.clientId)) continue;
        seen.add(link.clientId);
        links.push(link);
    }
    return { ok: true, links };
}

async function readBingPages(
    admin: Admin,
    organizationId: string,
    start: string,
    end: string,
): Promise<{ ok: true; rows: BingPageSource[] } | { ok: false }> {
    const rows: BingPageSource[] = [];
    for (let from = 0; from < 4000; from += PAGE) {
        const page = await admin
            .from('bing_page_weeks')
            .select(BING_PAGE_COLUMNS)
            .eq('organization_id', organizationId)
            .gte('week_ending', start)
            .lte('week_ending', end)
            .order('client_id')
            .range(from, from + PAGE - 1);
        if (page.error) return { ok: false };
        for (const row of page.data ?? []) {
            const parsed = readBingPageRow(row as Record<string, unknown>);
            if (parsed) rows.push(parsed);
        }
        if ((page.data ?? []).length < PAGE) return { ok: true, rows };
    }
    return { ok: true, rows };
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
        // authenticator's 8s statement_timeout survives set role service_role.
        // A 12-month query_page scan used to hit it. Migration 093 is the fix.
        const message = result.error.message ?? '';
        if (result.error.code === '57014' || /statement timeout|canceling statement/i.test(message)) {
            return { ok: false, status: 500, error: 'Top queries took too long to load.' };
        }
        return { ok: false, status: 500, error: 'Could not load queries.' };
    }
    try {
        const parsed = parseTopQueries(result.data);
        return { ok: true, queries: parsed.queries, reason: parsed.reason ? QUERY_GAP_LABEL[parsed.reason] : null };
    } catch {
        return { ok: false, status: 500, error: 'Could not load queries.' };
    }
}
