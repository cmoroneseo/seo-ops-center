import { fetchError, noData, notConfigured, ok, type FetchResult } from './fetch-result';
import { isClosedMonth, monthBounds } from './months';
import { getGoogleAccessToken, GoogleAuthError } from './token';

export interface GscDeps {
    getToken: typeof getGoogleAccessToken;
    fetch: typeof fetch;
    now: () => Date;
}

const defaultDeps: GscDeps = {
    getToken: getGoogleAccessToken,
    fetch,
    now: () => new Date(),
};

/**
 * Monthly Search Console totals for one property.
 * A closed month with no rows is a real zero. The current month with no rows
 * is not written yet. Ratios are null when there are no impressions.
 */
export async function fetchGSC(clientId: string, metricMonth: string, deps: Partial<GscDeps> = {}): Promise<FetchResult> {
    const resolved = { ...defaultDeps, ...deps };
    let auth: Awaited<ReturnType<GscDeps['getToken']>>;
    try {
        auth = await resolved.getToken(clientId, 'gsc');
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return fetchError(error.message, error.kind === 'transient', error.kind === 'reauth_required');
        }
        throw error;
    }
    if (!auth) return notConfigured('Search Console not connected');

    const siteUrl = auth.creds.site_url;
    if (typeof siteUrl !== 'string' || siteUrl.length === 0) {
        return notConfigured('Select a Search Console property');
    }

    const bounds = monthBounds(metricMonth);
    const res = await resolved.fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
            method: 'POST',
            signal: AbortSignal.timeout(20000),
            headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                startDate: bounds.start,
                endDate: bounds.end,
                type: 'web',
                aggregationType: 'auto',
            }),
        },
    );

    if (!res.ok) {
        return fetchError(
            `Search Console request failed (HTTP ${res.status})`,
            res.status >= 500 || res.status === 429,
        );
    }

    const data = await res.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length === 0) {
        if (!isClosedMonth(metricMonth, resolved.now())) return noData('no data yet for this month');
        return ok({ organic_clicks: 0, impressions: 0, avg_position: null, ctr: null });
    }

    const totals = rows.reduce(
        (acc: { clicks: number; impressions: number; positionSum: number }, row: { clicks?: number; impressions?: number; position?: number }) => ({
            clicks: acc.clicks + (row.clicks ?? 0),
            impressions: acc.impressions + (row.impressions ?? 0),
            positionSum: acc.positionSum + (row.position ?? 0) * (row.impressions ?? 0),
        }),
        { clicks: 0, impressions: 0, positionSum: 0 },
    );
    const impressions = totals.impressions;
    return ok({
        organic_clicks: Math.round(totals.clicks),
        impressions: Math.round(impressions),
        avg_position: impressions > 0 ? Math.round((totals.positionSum / impressions) * 10) / 10 : null,
        ctr: impressions > 0 ? Math.round((totals.clicks / impressions) * 10000) / 10000 : null,
    });
}
