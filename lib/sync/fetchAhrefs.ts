import { createAdminClient } from '@/lib/supabase/admin';
import { fetchError, notConfigured, ok, type FetchResult } from './fetch-result';
import { monthBounds, ptToday } from './months';

export interface AhrefsDeps {
    loadCredentials: (clientId: string) => Promise<{ apiKey?: string }>;
    loadTarget: (clientId: string) => Promise<string | null>;
    fetch: typeof fetch;
    now: () => Date;
}

type Query = {
    select: (columns: string) => Query;
    eq: (column: string, value: string) => Query;
    maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
};

/** Prefer the client domain. Fall back to the Search Console property with the sc-domain prefix removed. */
export function cleanAhrefsTarget(domain?: string | null, siteUrl?: string | null): string | null {
    const raw = (typeof domain === 'string' && domain.trim()) || (typeof siteUrl === 'string' && siteUrl.trim()) || '';
    if (!raw) return null;
    const cleaned = raw.replace(/^sc-domain:/i, '').replace(/^https?:\/\//i, '').split('/')[0].replace(/\/$/, '').trim();
    return cleaned || null;
}

export async function loadAhrefsCredentials(
    clientId: string,
    admin: { from: (table: string) => Query } = createAdminClient() as unknown as { from: (table: string) => Query },
): Promise<{ apiKey?: string }> {
    const { data, error } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', 'ahrefs')
        .maybeSingle();
    if (error) return {};
    const apiKey = (data as { credentials?: { api_key?: string } } | null)?.credentials?.api_key;
    return typeof apiKey === 'string' && apiKey.length > 0 ? { apiKey } : {};
}

export async function loadAhrefsTarget(
    clientId: string,
    admin: { from: (table: string) => Query } = createAdminClient() as unknown as { from: (table: string) => Query },
): Promise<string | null> {
    const { data: clientRow } = await admin.from('clients').select('domain').eq('id', clientId).maybeSingle();
    const { data: gscRow } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', 'gsc')
        .maybeSingle();
    const domain = (clientRow as { domain?: string | null } | null)?.domain;
    const siteUrl = (gscRow as { credentials?: { site_url?: string } } | null)?.credentials?.site_url;
    return cleanAhrefsTarget(domain, siteUrl);
}

const defaultDeps: AhrefsDeps = {
    loadCredentials: clientId => loadAhrefsCredentials(clientId),
    loadTarget: clientId => loadAhrefsTarget(clientId),
    fetch,
    now: () => new Date(),
};

/**
 * Ahrefs domain rating and organic-keyword tier counts for one month.
 * Keyword counts use a period comparison so a keyword that ranked at either
 * end of the month is included. Domain rating is the snapshot on the period end.
 */
export async function fetchAhrefs(clientId: string, metricMonth: string, deps: Partial<AhrefsDeps> = {}): Promise<FetchResult> {
    const resolved = { ...defaultDeps, ...deps };
    const credentials = await resolved.loadCredentials(clientId);
    if (!credentials.apiKey) return notConfigured('Ahrefs not connected');
    const target = await resolved.loadTarget(clientId);
    if (!target) return notConfigured('No website domain on the client');

    const bounds = monthBounds(metricMonth);
    const today = ptToday(resolved.now());
    const dateEnd = bounds.end > today ? today : bounds.end;
    const headers = { Authorization: `Bearer ${credentials.apiKey}` };

    let drRes: Response;
    let kwRes: Response;
    try {
        [drRes, kwRes] = await Promise.all([
            resolved.fetch(
                `https://api.ahrefs.com/v3/site-explorer/domain-rating?${new URLSearchParams({ target, date: dateEnd, output: 'json' })}`,
                { headers, signal: AbortSignal.timeout(20000) },
            ),
            resolved.fetch(
                `https://api.ahrefs.com/v3/site-explorer/organic-keywords?${new URLSearchParams({
                    target,
                    country: 'us',
                    limit: '1000',
                    date: dateEnd,
                    date_compared: bounds.start,
                    select: 'keyword,best_position,best_position_prev',
                    output: 'json',
                })}`,
                { headers, signal: AbortSignal.timeout(20000) },
            ),
        ]);
    } catch {
        return fetchError('Ahrefs request failed', true);
    }

    if (!drRes.ok || !kwRes.ok) {
        const failed = !drRes.ok ? drRes : kwRes;
        return fetchError(`Ahrefs request failed (HTTP ${failed.status})`, failed.status >= 500 || failed.status === 429);
    }

    const [drData, kwData] = await Promise.all([drRes.json(), kwRes.json()]);
    const rawRating = drData?.domain_rating?.domain_rating;
    const rating = rawRating == null || rawRating === '' ? null : Math.round(Number(rawRating));
    const keywords: { best_position?: number | null; best_position_prev?: number | null }[] = Array.isArray(kwData?.keywords) ? kwData.keywords : [];
    const inTier = (keyword: { best_position?: number | null; best_position_prev?: number | null }, max: number) =>
        (keyword.best_position != null && keyword.best_position <= max)
        || (keyword.best_position_prev != null && keyword.best_position_prev <= max);

    return ok({
        domain_rating: rating != null && Number.isFinite(rating) ? rating : null,
        ranked_keywords: keywords.length,
        top_10_keywords: keywords.filter(keyword => inTier(keyword, 10)).length,
        top_20_keywords: keywords.filter(keyword => inTier(keyword, 20)).length,
        top_50_keywords: keywords.filter(keyword => inTier(keyword, 50)).length,
    });
}
