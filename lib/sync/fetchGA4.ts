import { fetchError, noData, notConfigured, ok, type FetchResult } from './fetch-result';
import { isClosedMonth, monthBounds } from './months';
import { getGoogleAccessToken, GoogleAuthError } from './token';

export interface Ga4Deps {
    getToken: typeof getGoogleAccessToken;
    fetch: typeof fetch;
    now: () => Date;
}

const defaultDeps: Ga4Deps = {
    getToken: getGoogleAccessToken,
    fetch,
    now: () => new Date(),
};

function metricAt(report: { rows?: { metricValues?: { value?: string }[] }[] }, index: number): number | null {
    const raw = report?.rows?.[0]?.metricValues?.[index]?.value;
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/**
 * GA4 sessions for one property. The organic filter is exactly "Organic Search"
 * so Organic Video / Shopping / Social are not counted as SEO traffic.
 */
export async function fetchGA4(clientId: string, metricMonth: string, deps: Partial<Ga4Deps> = {}): Promise<FetchResult> {
    const resolved = { ...defaultDeps, ...deps };
    let auth: Awaited<ReturnType<Ga4Deps['getToken']>>;
    try {
        auth = await resolved.getToken(clientId, 'ga4');
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return fetchError(error.message, error.kind === 'transient', error.kind === 'reauth_required');
        }
        throw error;
    }
    if (!auth) return notConfigured('GA4 not connected');

    const propertyId = auth.creds.property_id;
    if (typeof propertyId !== 'string' || propertyId.length === 0) {
        return notConfigured('Select a GA4 property');
    }

    const bounds = monthBounds(metricMonth);
    const organicBody = {
        dateRanges: [{ startDate: bounds.start, endDate: bounds.end }],
        metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'bounceRate' }],
        dimensionFilter: {
            filter: {
                fieldName: 'sessionDefaultChannelGroup',
                stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
            },
        },
    };
    const totalBody = {
        dateRanges: [{ startDate: bounds.start, endDate: bounds.end }],
        metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'bounceRate' }],
    };
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    const endpoint = `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`;

    let organicRes: Response;
    let totalRes: Response;
    try {
        [organicRes, totalRes] = await Promise.all([
            resolved.fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(20000), headers, body: JSON.stringify(organicBody) }),
            resolved.fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(20000), headers, body: JSON.stringify(totalBody) }),
        ]);
    } catch {
        return fetchError('GA4 request failed', true);
    }

    if (!organicRes.ok || !totalRes.ok) {
        const failed = !organicRes.ok ? organicRes : totalRes;
        return fetchError(`GA4 request failed (HTTP ${failed.status})`, failed.status >= 500 || failed.status === 429);
    }

    const [organicData, totalData] = await Promise.all([organicRes.json(), totalRes.json()]);
    const totalRows = Array.isArray(totalData?.rows) ? totalData.rows : [];
    if (totalRows.length === 0) {
        if (!isClosedMonth(metricMonth, resolved.now())) return noData('no data yet for this month');
        return ok({ sessions: 0, new_users: 0, organic_sessions: 0, bounce_rate: null });
    }

    const organicRows = Array.isArray(organicData?.rows) ? organicData.rows : [];
    const bounce = metricAt(totalData, 2);
    return ok({
        sessions: metricAt(totalData, 0),
        new_users: metricAt(totalData, 1),
        bounce_rate: bounce == null ? null : Math.round(bounce * 1000) / 1000,
        // The property had sessions. An empty organic report means zero organic
        // sessions, not a missing metric.
        organic_sessions: organicRows.length === 0 ? 0 : metricAt(organicData, 0),
    });
}
