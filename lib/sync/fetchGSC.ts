import { getGoogleAccessToken, markIntegrationError, markIntegrationSynced } from './token';

/**
 * Fetch GSC metrics for a client for a given month.
 * Returns { organic_clicks, impressions, avg_position, ctr } or null on failure.
 *
 * Note: GSC shares the ga4 OAuth token (same Google account, same credentials row).
 * The site_url is stored in the gsc credentials row.
 */
export async function fetchGSC(
    clientId: string,
    metricMonth: string, // 'YYYY-MM'
): Promise<Record<string, number> | null> {
    // GSC uses the 'gsc' service row for site_url, but shares the ga4 OAuth token
    const auth = await getGoogleAccessToken(clientId, 'gsc' as any);
    if (!auth) {
        // Fallback: try ga4 token (same Google auth)
        const ga4Auth = await getGoogleAccessToken(clientId, 'ga4');
        if (!ga4Auth) return null;
        return fetchGSCWithToken(clientId, metricMonth, ga4Auth.token, ga4Auth.creds);
    }
    return fetchGSCWithToken(clientId, metricMonth, auth.token, auth.creds);
}

async function fetchGSCWithToken(
    clientId: string,
    metricMonth: string,
    token: string,
    creds: Record<string, any>,
): Promise<Record<string, number> | null> {
    const siteUrl = creds.site_url as string | undefined;
    if (!siteUrl) return null;

    const [y, m] = metricMonth.split('-').map(Number);
    const startDate = `${metricMonth}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${metricMonth}-${String(lastDay).padStart(2, '0')}`;

    const res = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
            method: 'POST',
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
        const err = await res.text();
        await markIntegrationError(clientId, 'gsc', `GSC API error: ${err.slice(0, 200)}`);
        return null;
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

    await markIntegrationSynced(clientId, 'gsc');
    return {
        organic_clicks: Math.round(totals.clicks),
        impressions: Math.round(impressions),
        avg_position,
        ctr,
    };
}
