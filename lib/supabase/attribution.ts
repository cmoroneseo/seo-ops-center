import { createClient } from './client';
import { normalizeDomain } from '../attribution/domain';
import { isSeoSource } from '../attribution/source-classifier';
import type {
    AttributionSite,
    AttributionConversion,
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
        scriptConfig?: ScriptConfig;
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
