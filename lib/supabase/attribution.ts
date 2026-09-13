import { createClient } from './client';
import { createAdminClient } from './admin';
import { rankQueries, type GscFact } from '../attribution/query-matcher';
import { matchesSiteDomain, normalizeDomain, pageBelongsToProperty } from '../attribution/domain';
import { isSeoSource, isSourceCategory } from '../attribution/source-classifier';
import type {
    AttributionSite,
    AttributionEvent,
    AttributionConversion,
    LikelyQuery,
    ScriptConfig,
} from '../types';

// --- Row mappers (DB snake_case <-> TS camelCase) ---

function rowToSite(row: any): AttributionSite {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        domain: row.domain,
        scriptConfig: row.script_config ?? {
            hdyhau_inject: false,
            hdyhau_field_patterns: [],
            track_tel_clicks: true,
        },
        isActive: row.is_active ?? true,
        verifiedAt: row.verified_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function eventToRow(e: Omit<AttributionEvent, 'id' | 'createdAt'>) {
    if (!isSourceCategory(e.sourceCategory)) throw new Error('Invalid attribution source');
    return {
        organization_id: e.organizationId,
        site_id: e.siteId,
        site_domain: e.siteDomain,
        event_type: e.eventType,
        session_id: e.sessionId,
        visitor_id: e.visitorId,
        source_category: e.sourceCategory,
        referrer_domain: e.referrerDomain,
        landing_page: e.landingPage,
        page_url: e.pageUrl,
        hdyhau_response: e.hdyhauResponse,
        utm_source: e.utmSource,
        utm_medium: e.utmMedium,
        utm_campaign: e.utmCampaign,
        country_code: e.countryCode,
        device_type: e.deviceType,
    };
}

function rowToConversion(row: any): AttributionConversion {
    return {
        id: row.id,
        organizationId: row.organization_id,
        siteId: row.site_id,
        clientId: row.client_id,
        eventId: row.event_id,
        conversionType: row.conversion_type,
        sourceCategory: row.source_category,
        landingPage: row.landing_page,
        pageUrl: row.page_url,
        likelyQueries: row.likely_queries ?? [],
        hdyhauResponse: row.hdyhau_response ?? undefined,
        month: typeof row.month === 'string' ? row.month.slice(0, 7) : row.month,
        createdAt: row.created_at,
    };
}

function conversionToRow(
    c: Omit<AttributionConversion, 'id' | 'createdAt' | 'likelyQueries'> & { likelyQueries?: LikelyQuery[] },
) {
    if (!isSourceCategory(c.sourceCategory)) throw new Error('Invalid attribution source');
    return {
        organization_id: c.organizationId,
        site_id: c.siteId,
        client_id: c.clientId,
        event_id: c.eventId,
        conversion_type: c.conversionType,
        source_category: c.sourceCategory,
        landing_page: c.landingPage,
        page_url: c.pageUrl,
        likely_queries: c.likelyQueries ?? null,
        hdyhau_response: c.hdyhauResponse,
        month: c.month.length === 7 ? c.month + '-01' : c.month,
    };
}

// --- Attribution sites ---

export async function getAttributionSite(clientId: string): Promise<AttributionSite | null> {
    const supabase = createClient();
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('attribution_sites')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
    if (error) throw error;
    return data ? rowToSite(data) : null;
}

export async function createAttributionSite(params: {
    organizationId: string;
    clientId: string;
    domain: string;
    scriptConfig?: Partial<ScriptConfig>;
}): Promise<AttributionSite> {
    const supabase = createClient();
    if (!supabase) throw new Error('Not authenticated');
    const domain = normalizeDomain(params.domain);
    if (!domain) throw new Error('Enter a valid website domain.');
    const scriptConfig: ScriptConfig = {
        hdyhau_inject: false,
        hdyhau_field_patterns: [],
        track_tel_clicks: true,
        ...params.scriptConfig,
    };
    const { data, error } = await supabase
        .from('attribution_sites')
        .insert({
            organization_id: params.organizationId,
            client_id: params.clientId,
            domain,
            script_config: scriptConfig,
        })
        .select()
        .single();
    if (error) throw error;
    return rowToSite(data);
}

export async function updateAttributionSite(
    id: string,
    params: {
        domain?: string;
        scriptConfig?: Partial<ScriptConfig>;
        isActive?: boolean;
    },
): Promise<AttributionSite> {
    const supabase = createClient();
    if (!supabase) throw new Error('Not authenticated');
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (params.domain !== undefined) {
        const domain = normalizeDomain(params.domain);
        if (!domain) throw new Error('Enter a valid website domain.');
        row.domain = domain;
    }
    if (params.scriptConfig !== undefined) row.script_config = params.scriptConfig;
    if (params.isActive !== undefined) row.is_active = params.isActive;
    const { data, error } = await supabase
        .from('attribution_sites')
        .update(row)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return rowToSite(data);
}

/** Verification is stamped by the database only after a valid event is received. */
export async function verifyAttributionSite(id: string): Promise<AttributionSite> {
    const supabase = createClient();
    if (!supabase) throw new Error('Not authenticated');
    const { data, error } = await supabase.from('attribution_sites').select('*').eq('id', id).single();
    if (error) throw error;
    if (!data.is_active || !data.verified_at) {
        throw new Error('No tracking event received for this domain yet. Open the website after installing the script, wait a few seconds, then try again.');
    }
    return rowToSite(data);
}

const PAGE_SIZE = 1000;
type PageResult<T> = { data: T[] | null; error: unknown };

/** Read past PostgREST's row cap in deterministic primary-key order. */
async function readAllById<T extends { id: string | number }>(
    fetchPage: (after?: string | number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
    const rows: T[] = [];
    let after: string | number | undefined;
    while (true) {
        const { data, error } = await fetchPage(after);
        if (error) throw error;
        if (!data?.length) return rows;
        const lastId = data[data.length - 1].id;
        if (lastId === after) throw new Error('Attribution pagination did not advance');
        rows.push(...data);
        after = lastId;
    }
}

// --- Attribution events ---
// Written by the unauthenticated collection endpoint with the service-role
// key (RLS grants insert to service_role only — see migration 056).

export async function insertEvents(rows: Omit<AttributionEvent, 'id' | 'createdAt'>[]): Promise<void> {
    if (rows.length === 0) return;
    const admin = createAdminClient();
    const { error } = await admin.from('attribution_events').insert(rows.map(eventToRow));
    if (error) throw error;
}

// --- Attribution conversions ---
// Written server-side with the service-role key (RLS grants insert/update to
// service_role only — see migration 056).

export async function insertConversion(
    row: Omit<AttributionConversion, 'id' | 'createdAt' | 'likelyQueries'> & { likelyQueries?: LikelyQuery[] },
): Promise<string> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('attribution_conversions')
        .insert(conversionToRow(row))
        .select('id')
        .single();
    if (error) throw error;
    return data.id;
}

export async function getConversions(
    clientId: string,
    opts: { month?: string; sourceCategory?: string; limit?: number } = {},
): Promise<AttributionConversion[]> {
    const supabase = createClient();
    if (!supabase) throw new Error('Not authenticated');
    const data = await readAllById<any>(after => {
        let query = supabase.from('attribution_conversions').select('*')
            .eq('client_id', clientId).order('id').limit(PAGE_SIZE);
        if (opts.month) query = query.eq('month', `${opts.month.slice(0, 7)}-01`);
        if (opts.sourceCategory) query = query.eq('source_category', opts.sourceCategory);
        if (after !== undefined) query = query.gt('id', after);
        return query;
    });
    const conversions = data.map(rowToConversion)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return opts.limit ? conversions.slice(0, opts.limit) : conversions;
}

export interface ConversionQueryScope { organizationId: string; siteId: string; clientId: string }

/** Conversions with no likely-queries match yet, within the lookback window. Used by the query-matching cron. */
export async function getConversionsMissingQueries(
    lookbackDays = 7,
): Promise<(ConversionQueryScope & { id: string; landingPage: string; month: string })[]> {
    const admin = createAdminClient();
    const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
    const data = await readAllById<any>(after => {
        let query = admin.from('attribution_conversions')
            .select('id, organization_id, site_id, client_id, landing_page, month')
            .is('likely_queries', null).gte('created_at', since).order('id').limit(PAGE_SIZE);
        if (after !== undefined) query = query.gt('id', after);
        return query;
    });
    return data.map(r => ({
        id: r.id,
        organizationId: r.organization_id,
        siteId: r.site_id,
        clientId: r.client_id,
        landingPage: r.landing_page,
        month: r.month,
    }));
}

export async function updateConversionQueries(id: string, queries: LikelyQuery[], scope?: ConversionQueryScope): Promise<void> {
    const admin = createAdminClient();
    let update = admin
        .from('attribution_conversions')
        .update({ likely_queries: queries })
        .eq('id', id).is('likely_queries', null);
    if (scope) update = update.eq('organization_id', scope.organizationId).eq('site_id', scope.siteId).eq('client_id', scope.clientId);
    const { error } = await update;
    if (error) throw error;
}

/** Deletes pageview events older than the retention window. Returns the number of rows deleted. */
export async function deleteOldPageviews(retentionDays = 90): Promise<number> {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const { data, error } = await admin
        .from('attribution_events')
        .delete()
        .eq('event_type', 'pageview')
        .lt('created_at', cutoff)
        .select('id');
    if (error) throw error;
    return data?.length ?? 0;
}

// --- Query matching ---

/**
 * Looks up GSC query/page facts for a client's imported history month and
 * ranks the queries most likely to have driven a conversion on landingPage.
 * `month` is 'YYYY-MM'. Returns [] when no GSC history has been imported for
 * that month.
 */
export async function matchQueries(
    clientId: string,
    landingPage: string,
    month: string,
    scope?: Pick<ConversionQueryScope, 'organizationId' | 'siteId'>,
): Promise<LikelyQuery[]> {
    const admin = createAdminClient();
    let siteQuery = admin.from('attribution_sites').select('id, organization_id, client_id, domain')
        .eq('client_id', clientId);
    if (scope) siteQuery = siteQuery.eq('id', scope.siteId).eq('organization_id', scope.organizationId);
    const { data: site, error: siteError } = await siteQuery.maybeSingle();
    if (siteError) throw siteError;
    if (!site) return [];

    const { data: client, error: clientError } = await admin.from('clients').select('id')
        .eq('id', clientId).eq('organization_id', site.organization_id).maybeSingle();
    if (clientError) throw clientError;
    if (!client) throw new Error('Attribution client organization mismatch');

    const { data: integration, error: integrationError } = await admin.from('client_integrations')
        .select('property:credentials->>site_url').eq('client_id', clientId).eq('organization_id', site.organization_id)
        .eq('service', 'gsc').in('sync_status', ['active', 'error']).maybeSingle();
    if (integrationError) throw integrationError;
    const property = integration?.property;
    if (typeof property !== 'string') return [];
    let target: URL;
    try { target = new URL(landingPage, `https://${site.domain}`); } catch { return []; }
    if (!matchesSiteDomain(target.hostname, site.domain) || !pageBelongsToProperty(target.href, property)) return [];
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid attribution month');
    const monthStart = `${month}-01`;
    const [year, mon] = month.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 10);

    const { data: days, error: daysError } = await admin
        .from('gsc_history_days')
        .select('id')
        .eq('organization_id', site.organization_id)
        .eq('client_id', clientId)
        .eq('property', property)
        .eq('search_type', 'web')
        .gte('data_date', monthStart)
        .lt('data_date', monthEnd);
    if (daysError) throw daysError;
    if (!days || days.length === 0) return [];

    const dayIds = days.map((d: any) => d.id);
    const factRows = await readAllById<any>(after => {
        let query = admin.from('gsc_history_facts').select('id, page, query, clicks, impressions')
            .in('day_id', dayIds).eq('grain', 'query_page').order('id').limit(PAGE_SIZE);
        if (after !== undefined) query = query.gt('id', after);
        return query;
    });

    const facts: GscFact[] = factRows.filter(f => pageBelongsToProperty(f.page, property)).map(f => ({
        page: f.page,
        query: f.query,
        clicks: Number(f.clicks),
        impressions: Number(f.impressions),
    }));

    return rankQueries(facts, target.href);
}

// --- Attribution dashboard queries ---

export async function getEventCountsBySource(
    clientId: string,
    month: string,
): Promise<{ sourceCategory: string; count: number }[]> {
    const data = await getConversions(clientId, { month });
    const counts = new Map<string, number>();
    for (const row of data) {
        counts.set(row.sourceCategory, (counts.get(row.sourceCategory) ?? 0) + 1);
    }
    return Array.from(counts, ([sourceCategory, count]) => ({ sourceCategory, count }))
        .sort((a, b) => b.count - a.count);
}

export async function getLandingPagePerformance(
    clientId: string,
    month: string,
): Promise<{ landingPage: string; count: number; topQuery: string; organicPct: number }[]> {
    const data = await getConversions(clientId, { month });
    const pages = new Map<string, { total: number; organic: number; topQuery: string }>();
    for (const row of data) {
        const page = row.landingPage || '/';
        const entry = pages.get(page) ?? { total: 0, organic: 0, topQuery: '' };
        entry.total++;
        if (isSeoSource(row.sourceCategory)) entry.organic++;
        if (!entry.topQuery && row.likelyQueries[0]?.query) entry.topQuery = row.likelyQueries[0].query;
        pages.set(page, entry);
    }
    return Array.from(pages, ([landingPage, v]) => ({
        landingPage,
        count: v.total,
        topQuery: v.topQuery,
        organicPct: v.total > 0 ? Math.round((v.organic / v.total) * 100) : 0,
    })).sort((a, b) => b.count - a.count);
}
