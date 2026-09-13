import { createClient } from './client';
import { createAdminClient } from './admin';
import { rankQueries, type GscFact } from '../attribution/query-matcher';
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

function rowToEvent(row: any): AttributionEvent {
    return {
        id: row.id,
        organizationId: row.organization_id,
        siteId: row.site_id,
        eventType: row.event_type,
        sessionId: row.session_id,
        visitorId: row.visitor_id,
        sourceCategory: row.source_category,
        referrerDomain: row.referrer_domain ?? undefined,
        landingPage: row.landing_page,
        pageUrl: row.page_url,
        hdyhauResponse: row.hdyhau_response ?? undefined,
        utmSource: row.utm_source ?? undefined,
        utmMedium: row.utm_medium ?? undefined,
        utmCampaign: row.utm_campaign ?? undefined,
        countryCode: row.country_code ?? undefined,
        deviceType: row.device_type ?? undefined,
        createdAt: row.created_at,
    };
}

function eventToRow(e: Omit<AttributionEvent, 'id' | 'createdAt'>) {
    return {
        organization_id: e.organizationId,
        site_id: e.siteId,
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
            domain: params.domain,
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
        verifiedAt?: string;
    },
): Promise<AttributionSite> {
    const supabase = createClient();
    if (!supabase) throw new Error('Not authenticated');
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (params.domain !== undefined) row.domain = params.domain;
    if (params.scriptConfig !== undefined) row.script_config = params.scriptConfig;
    if (params.isActive !== undefined) row.is_active = params.isActive;
    if (params.verifiedAt !== undefined) row.verified_at = params.verifiedAt;
    const { data, error } = await supabase
        .from('attribution_sites')
        .update(row)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return rowToSite(data);
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
    if (!supabase) return [];
    let query = supabase
        .from('attribution_conversions')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
    if (opts.month) query = query.eq('month', `${opts.month}-01`);
    if (opts.sourceCategory) query = query.eq('source_category', opts.sourceCategory);
    if (opts.limit) query = query.limit(opts.limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(rowToConversion);
}

/** Conversions with no likely-queries match yet, within the lookback window. Used by the query-matching cron. */
export async function getConversionsMissingQueries(
    lookbackDays = 7,
): Promise<{ id: string; clientId: string; landingPage: string; month: string }[]> {
    const admin = createAdminClient();
    const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
    const { data, error } = await admin
        .from('attribution_conversions')
        .select('id, client_id, landing_page, month')
        .is('likely_queries', null)
        .gte('created_at', since);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
        id: r.id,
        clientId: r.client_id,
        landingPage: r.landing_page,
        month: r.month,
    }));
}

export async function updateConversionQueries(id: string, queries: LikelyQuery[]): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin
        .from('attribution_conversions')
        .update({ likely_queries: queries })
        .eq('id', id);
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
): Promise<LikelyQuery[]> {
    const admin = createAdminClient();
    const monthStart = `${month}-01`;
    const [year, mon] = month.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 10);

    const { data: days, error: daysError } = await admin
        .from('gsc_history_days')
        .select('id')
        .eq('client_id', clientId)
        .gte('data_date', monthStart)
        .lt('data_date', monthEnd);
    if (daysError) throw daysError;
    if (!days || days.length === 0) return [];

    const dayIds = days.map((d: any) => d.id);
    const { data: factRows, error: factsError } = await admin
        .from('gsc_history_facts')
        .select('page, query, clicks, impressions')
        .in('day_id', dayIds)
        .eq('grain', 'query_page');
    if (factsError) throw factsError;

    const facts: GscFact[] = (factRows ?? []).map((f: any) => ({
        page: f.page,
        query: f.query,
        clicks: f.clicks,
        impressions: f.impressions,
    }));

    return rankQueries(facts, landingPage);
}

// --- Attribution dashboard queries ---

export async function getEventCountsBySource(
    clientId: string,
    month: string,
): Promise<{ sourceCategory: string; count: number }[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data } = await supabase
        .from('attribution_conversions')
        .select('source_category')
        .eq('client_id', clientId)
        .eq('month', month + '-01');
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const row of data) {
        counts.set(row.source_category, (counts.get(row.source_category) ?? 0) + 1);
    }
    return Array.from(counts, ([sourceCategory, count]) => ({ sourceCategory, count }))
        .sort((a, b) => b.count - a.count);
}

export async function getLandingPagePerformance(
    clientId: string,
    month: string,
): Promise<{ landingPage: string; count: number; topQuery: string; organicPct: number }[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data } = await supabase
        .from('attribution_conversions')
        .select('landing_page, source_category, likely_queries')
        .eq('client_id', clientId)
        .eq('month', month + '-01');
    if (!data) return [];
    const pages = new Map<string, { total: number; organic: number; topQuery: string }>();
    for (const row of data) {
        const page = row.landing_page || '/';
        const entry = pages.get(page) ?? { total: 0, organic: 0, topQuery: '' };
        entry.total++;
        if (row.source_category.startsWith('organic_') || row.source_category.startsWith('ai_')) entry.organic++;
        if (!entry.topQuery && row.likely_queries?.[0]?.query) entry.topQuery = row.likely_queries[0].query;
        pages.set(page, entry);
    }
    return Array.from(pages, ([landingPage, v]) => ({
        landingPage,
        count: v.total,
        topQuery: v.topQuery,
        organicPct: v.total > 0 ? Math.round((v.organic / v.total) * 100) : 0,
    })).sort((a, b) => b.count - a.count);
}
