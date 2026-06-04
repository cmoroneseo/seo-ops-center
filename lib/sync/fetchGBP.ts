import { getGoogleAccessToken, markIntegrationError, markIntegrationSynced } from './token';

/**
 * Fetch GBP metrics for a client for a given month.
 * Returns { impressions, calls, direction_requests, website_clicks, review_count, avg_rating } or null.
 *
 * NOTE: GBP API requires separate quota approval from Google.
 * This will return null gracefully until quota is granted.
 */
export async function fetchGBP(
    clientId: string,
    metricMonth: string, // 'YYYY-MM'
): Promise<Record<string, number> | null> {
    const auth = await getGoogleAccessToken(clientId, 'gbp');
    if (!auth) return null;

    const { token, creds } = auth;
    const locationName = creds.location_name as string | undefined;
    if (!locationName) return null;

    const [y, m] = metricMonth.split('-').map(Number);
    const startTime = new Date(y, m - 1, 1).toISOString();
    const endTime = new Date(y, m, 0, 23, 59, 59).toISOString();

    // Fetch insights (impressions, calls, directions, website clicks)
    const insightsRes = await fetch(
        `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries?` +
        new URLSearchParams({
            'dailyMetrics': 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
            'dailyRange.startDate.year': String(y),
            'dailyRange.startDate.month': String(m),
            'dailyRange.startDate.day': '1',
            'dailyRange.endDate.year': String(y),
            'dailyRange.endDate.month': String(m),
            'dailyRange.endDate.day': String(new Date(y, m, 0).getDate()),
        }),
        { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!insightsRes.ok) {
        const err = await insightsRes.text();
        // Silently skip if quota not yet approved (403)
        if (insightsRes.status === 403) return null;
        await markIntegrationError(clientId, 'gbp', `GBP API error: ${err.slice(0, 200)}`);
        return null;
    }

    // Fetch reviews for count + avg rating
    const reviewsRes = await fetch(
        `https://mybusiness.googleapis.com/v4/${locationName}/reviews?pageSize=1`,
        { headers: { Authorization: `Bearer ${token}` } },
    );

    let review_count = 0;
    let avg_rating = 0;
    if (reviewsRes.ok) {
        const reviewData = await reviewsRes.json();
        review_count = reviewData.totalReviewCount ?? 0;
        avg_rating = reviewData.averageRating ?? 0;
    }

    const insightsData = await insightsRes.json();

    // Sum all daily values for the month
    function sumMetric(metricName: string): number {
        const series = insightsData.multiDailyMetricTimeSeries?.find(
            (s: any) => s.dailyMetric === metricName,
        );
        return (series?.timeSeries?.datedValues ?? []).reduce(
            (sum: number, dv: any) => sum + (Number(dv.value) || 0), 0,
        );
    }

    await markIntegrationSynced(clientId, 'gbp');
    return {
        impressions: sumMetric('BUSINESS_IMPRESSIONS_DESKTOP_MAPS') +
                     sumMetric('BUSINESS_IMPRESSIONS_MOBILE_MAPS') +
                     sumMetric('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH') +
                     sumMetric('BUSINESS_IMPRESSIONS_MOBILE_SEARCH'),
        calls: sumMetric('CALL_CLICKS'),
        direction_requests: sumMetric('BUSINESS_DIRECTION_REQUESTS'),
        website_clicks: sumMetric('WEBSITE_CLICKS'),
        review_count,
        avg_rating: Math.round(avg_rating * 10) / 10,
    };
}
