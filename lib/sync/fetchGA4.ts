import { getGoogleAccessToken, markIntegrationError, markIntegrationSynced } from './token';

/**
 * Fetch GA4 metrics for a client for a given month.
 * Returns { sessions, new_users, bounce_rate, organic_sessions } or null on failure.
 */
export async function fetchGA4(
    clientId: string,
    metricMonth: string, // 'YYYY-MM'
): Promise<Record<string, number> | null> {
    const auth = await getGoogleAccessToken(clientId, 'ga4');
    if (!auth) return null;

    const { token, creds } = auth;
    const propertyId = creds.property_id as string | undefined;
    if (!propertyId) return null;

    // Build date range: first to last day of month
    const [y, m] = metricMonth.split('-').map(Number);
    const startDate = `${metricMonth}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${metricMonth}-${String(lastDay).padStart(2, '0')}`;

    const body = {
        dateRanges: [{ startDate, endDate }],
        metrics: [
            { name: 'sessions' },
            { name: 'newUsers' },
            { name: 'bounceRate' },
        ],
        dimensionFilter: {
            filter: {
                fieldName: 'sessionDefaultChannelGroup',
                // EXACT, not CONTAINS — "Organic" would also sweep in Organic
                // Video / Shopping / Social. GA4's "Organic Search" is the SEO metric.
                stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
            },
        },
    };

    // Fetch both total sessions and organic-only in parallel
    const [organicRes, totalRes] = await Promise.all([
        fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }),
        fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dateRanges: [{ startDate, endDate }],
                metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'bounceRate' }],
            }),
        }),
    ]);

    if (!organicRes.ok || !totalRes.ok) {
        const errText = await (organicRes.ok ? totalRes : organicRes).text();
        await markIntegrationError(clientId, 'ga4', `GA4 API error: ${errText.slice(0, 200)}`);
        return null;
    }

    const [organicData, totalData] = await Promise.all([organicRes.json(), totalRes.json()]);

    function getMetricVal(report: any, index: number): number {
        return Number(report?.rows?.[0]?.metricValues?.[index]?.value ?? 0);
    }

    const result = {
        sessions: getMetricVal(totalData, 0),
        new_users: getMetricVal(totalData, 1),
        bounce_rate: Math.round(getMetricVal(totalData, 2) * 1000) / 1000,
        organic_sessions: getMetricVal(organicData, 0),
    };

    await markIntegrationSynced(clientId, 'ga4');
    return result;
}
