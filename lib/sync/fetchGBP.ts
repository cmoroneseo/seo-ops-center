import { fetchError, noData, notConfigured, ok, type FetchResult } from './fetch-result';
import { monthBounds } from './months';
import { getGoogleAccessToken, GoogleAuthError } from './token';

export interface GbpDeps {
    getToken: typeof getGoogleAccessToken;
    fetch: typeof fetch;
    now: () => Date;
}

const defaultDeps: GbpDeps = {
    getToken: getGoogleAccessToken,
    fetch,
    now: () => new Date(),
};

const IMPRESSIONS = [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
] as const;

const ACTIONS = ['CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'WEBSITE_CLICKS'] as const;
const DAILY_METRICS = [...IMPRESSIONS, ...ACTIONS];

type DatedValue = { value?: string | number | null };
type Series = { datedValues?: DatedValue[] };

/** The Performance API nests series; older payloads put dailyMetric on the outer object. */
function findSeries(payload: unknown, metric: string): Series | null {
    const root = payload as { multiDailyMetricTimeSeries?: unknown[] } | null;
    const items = Array.isArray(root?.multiDailyMetricTimeSeries) ? root.multiDailyMetricTimeSeries : [];
    for (const item of items) {
        const record = item as { dailyMetric?: string; timeSeries?: Series; dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: Series }[] };
        if (record.dailyMetric === metric) return record.timeSeries ?? { datedValues: [] };
        for (const inner of record.dailyMetricTimeSeries ?? []) {
            if (inner.dailyMetric === metric) return inner.timeSeries ?? { datedValues: [] };
        }
    }
    return null;
}

/** A present series sums to a number. Google omits zero days, so a missing value is 0. An absent series is null. */
function sumSeries(payload: unknown, metric: string): number | null {
    const series = findSeries(payload, metric);
    if (!series) return null;
    return (series.datedValues ?? []).reduce((sum, day) => {
        if (day.value == null || day.value === '') return sum;
        const value = Number(day.value);
        return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
}

export async function fetchGBP(clientId: string, metricMonth: string, deps: Partial<GbpDeps> = {}): Promise<FetchResult> {
    const resolved = { ...defaultDeps, ...deps };
    let auth: Awaited<ReturnType<GbpDeps['getToken']>>;
    try {
        auth = await resolved.getToken(clientId, 'gbp');
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return fetchError(error.message, error.kind === 'transient', error.kind === 'reauth_required');
        }
        throw error;
    }
    if (!auth) return notConfigured('Business Profile not connected');

    const locationName = auth.creds.location_name;
    if (typeof locationName !== 'string' || locationName.length === 0) {
        return notConfigured('Select a Business Profile location');
    }

    const bounds = monthBounds(metricMonth);
    const [startYear, startMonth] = bounds.start.split('-').map(Number);
    const [endYear, endMonth, endDay] = bounds.end.split('-').map(Number);
    const params = new URLSearchParams();
    for (const metric of DAILY_METRICS) params.append('dailyMetrics', metric);
    params.set('dailyRange.startDate.year', String(startYear));
    params.set('dailyRange.startDate.month', String(startMonth));
    params.set('dailyRange.startDate.day', '1');
    params.set('dailyRange.endDate.year', String(endYear));
    params.set('dailyRange.endDate.month', String(endMonth));
    params.set('dailyRange.endDate.day', String(endDay));

    let insightsRes: Response;
    try {
        insightsRes = await resolved.fetch(
            `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries?${params}`,
            { headers: { Authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(20000) },
        );
    } catch {
        return fetchError('Business Profile request failed', true);
    }

    if (!insightsRes.ok) {
        if (insightsRes.status === 403) {
            return fetchError('Business Profile API access not approved for this location (HTTP 403)', false);
        }
        return fetchError(
            `Business Profile request failed (HTTP ${insightsRes.status})`,
            insightsRes.status >= 500 || insightsRes.status === 429,
        );
    }

    const insights = await insightsRes.json();
    const calls = sumSeries(insights, 'CALL_CLICKS');
    const directionRequests = sumSeries(insights, 'BUSINESS_DIRECTION_REQUESTS');
    const websiteClicks = sumSeries(insights, 'WEBSITE_CLICKS');
    const impressionParts = IMPRESSIONS.map(metric => sumSeries(insights, metric));
    const impressions = impressionParts.every(value => value != null)
        ? impressionParts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null;

    if (impressions == null && calls == null && directionRequests == null && websiteClicks == null) {
        return noData('no Business Profile metrics for this month');
    }

    let reviewCount: number | null = null;
    let avgRating: number | null = null;
    try {
        const reviewsRes = await resolved.fetch(
            `https://mybusiness.googleapis.com/v4/${locationName}/reviews?pageSize=1`,
            { headers: { Authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(20000) },
        );
        if (reviewsRes.ok) {
            const reviewData = await reviewsRes.json();
            reviewCount = typeof reviewData.totalReviewCount === 'number' ? reviewData.totalReviewCount : null;
            avgRating = typeof reviewData.averageRating === 'number'
                ? Math.round(reviewData.averageRating * 10) / 10
                : null;
        }
    } catch {
        reviewCount = null;
        avgRating = null;
    }

    return ok({
        impressions,
        calls,
        direction_requests: directionRequests,
        website_clicks: websiteClicks,
        review_count: reviewCount,
        avg_rating: avgRating,
    });
}
