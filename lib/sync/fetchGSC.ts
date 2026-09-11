import { getGoogleAccessToken, markIntegrationError } from './token';

/**
 * Fetch GSC metrics for a client for a given month.
 * Returns { organic_clicks, impressions, avg_position, ctr } or null on failure.
 *
 * Uses only the GSC connection; GA4 grants are independent.
 */
export async function fetchGSC(clientId: string, metricMonth: string, deps = { getToken: getGoogleAccessToken, fetch, markError: markIntegrationError }): Promise<Record<string, number> | null> {
    const auth = await deps.getToken(clientId, 'gsc');
    if (!auth) return null;
    return fetchGSCWithToken(clientId, metricMonth, auth.token, auth.creds, deps);
}

async function fetchGSCWithToken(
    clientId: string,
    metricMonth: string,
    token: string,
    creds: Record<string, any>,
    deps: { fetch: typeof fetch; markError: typeof markIntegrationError },
): Promise<Record<string, number> | null> {
    const siteUrl = creds.site_url as string | undefined;
    if (!siteUrl) throw new Error('Select a primary Search Console property before syncing.');

    const [y, m] = metricMonth.split('-').map(Number);
    const startDate = `${metricMonth}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${metricMonth}-${String(lastDay).padStart(2, '0')}`;

    const res = await deps.fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
            method: 'POST',
            signal: AbortSignal.timeout(20000),
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                startDate,
                endDate,
                type: 'web',
                aggregationType: 'auto',
            }),
        },
    );

    if (!res.ok) {
        const message = `Search Console request failed (HTTP ${res.status}). Check property access or reconnect.`;
        await deps.markError(clientId, 'gsc', message);
        throw new Error(message);
    }

    const data = await res.json();
    const totals = data.rows?.reduce(
        (acc: Record<string, number>, row: any) => ({
            clicks: acc.clicks + (row.clicks ?? 0),
            impressions: acc.impressions + (row.impressions ?? 0),
            position_sum: acc.position_sum + (row.position ?? 0) * (row.impressions ?? 0),
            impression_count: acc.impression_count + (row.impressions ?? 0),
        }),
        { clicks: 0, impressions: 0, position_sum: 0, impression_count: 0 },
    ) ?? { clicks: 0, impressions: 0, position_sum: 0, impression_count: 0 };

    const impressions = totals.impressions;
    const avg_position = impressions > 0
        ? Math.round((totals.position_sum / impressions) * 10) / 10
        : 0;
    const ctr = impressions > 0
        ? Math.round((totals.clicks / impressions) * 10000) / 10000
        : 0;

    return {
        organic_clicks: Math.round(totals.clicks),
        impressions: Math.round(impressions),
        avg_position,
        ctr,
    };
}
