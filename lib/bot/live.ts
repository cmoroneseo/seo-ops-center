import { GoogleAuthError } from '@/lib/sync/token';

/**
 * Live Google reads for the bot API. The bearer sent to Google is never
 * copied into the returned object.
 */

export interface LiveToken {
    token: string;
    creds: Record<string, unknown>;
}

export interface LiveDeps {
    getToken: (clientId: string, service: 'ga4' | 'gsc') => Promise<LiveToken | null>;
    fetch: typeof fetch;
}

export type LiveFailure = { ok: false; status: number; error: string; code: 'not_connected' | 'reauth_required' | 'upstream' };
export type LiveGa4 = {
    ok: true;
    property: string;
    totals: {
        organicSessions: number | null;
        sessions: number | null;
        engagedSessions: number | null;
        keyEvents: number | null;
    };
};
export type LiveGsc = {
    ok: true;
    property: string;
    totals: {
        clicks: number | null;
        impressions: number | null;
        ctr: number | null;
        position: number | null;
    };
};

const GA4_PROPERTY = /^properties\/[0-9]+$/;

export async function readLiveGa4(clientId: string, start: string, end: string, deps: LiveDeps): Promise<LiveGa4 | LiveFailure> {
    const auth = await takeToken(clientId, 'ga4', deps);
    if (!auth.ok) return auth;
    const property = auth.creds.property_id;
    if (typeof property !== 'string' || !GA4_PROPERTY.test(property)) {
        return { ok: false, status: 404, error: 'GA4 is not connected', code: 'not_connected' };
    }

    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    const endpoint = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
    const organicBody = {
        dateRanges: [{ startDate: start, endDate: end }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: {
            filter: {
                fieldName: 'sessionDefaultChannelGroup',
                stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
            },
        },
    };
    const totalBody = {
        dateRanges: [{ startDate: start, endDate: end }],
        metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
    };

    let organicRes: Response;
    let totalRes: Response;
    try {
        [organicRes, totalRes] = await Promise.all([
            deps.fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(20_000), headers, body: JSON.stringify(organicBody) }),
            deps.fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(20_000), headers, body: JSON.stringify(totalBody) }),
        ]);
    } catch {
        return { ok: false, status: 503, error: 'GA4 request failed', code: 'upstream' };
    }
    if (!organicRes.ok || !totalRes.ok) {
        return { ok: false, status: 502, error: 'GA4 request failed', code: 'upstream' };
    }

    const [organicData, totalData] = await Promise.all([organicRes.json(), totalRes.json()]);
    const organicRows = Array.isArray(organicData?.rows) ? organicData.rows : [];
    const totalRows = Array.isArray(totalData?.rows) ? totalData.rows : [];
    return {
        ok: true,
        property,
        totals: {
            organicSessions: organicRows.length === 0 ? 0 : metricAt(organicData, 0),
            sessions: totalRows.length === 0 ? 0 : metricAt(totalData, 0),
            engagedSessions: totalRows.length === 0 ? 0 : metricAt(totalData, 1),
            keyEvents: totalRows.length === 0 ? 0 : metricAt(totalData, 2),
        },
    };
}

export async function readLiveGsc(clientId: string, start: string, end: string, deps: LiveDeps): Promise<LiveGsc | LiveFailure> {
    const auth = await takeToken(clientId, 'gsc', deps);
    if (!auth.ok) return auth;
    const property = auth.creds.site_url;
    if (typeof property !== 'string' || property.length === 0 || property.length > 500) {
        return { ok: false, status: 404, error: 'Search Console is not connected', code: 'not_connected' };
    }

    let response: Response;
    try {
        response = await deps.fetch(
            `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
            {
                method: 'POST',
                signal: AbortSignal.timeout(20_000),
                headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate: start, endDate: end, type: 'web', aggregationType: 'auto' }),
            },
        );
    } catch {
        return { ok: false, status: 503, error: 'Search Console request failed', code: 'upstream' };
    }
    if (!response.ok) {
        return { ok: false, status: 502, error: 'Search Console request failed', code: 'upstream' };
    }
    const data = await response.json();
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const row = rows[0] as { clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown } | undefined;
    const clicks = numberOrNull(row?.clicks);
    const impressions = numberOrNull(row?.impressions);
    return {
        ok: true,
        property,
        totals: {
            clicks: clicks == null ? 0 : Math.round(clicks),
            impressions: impressions == null ? 0 : Math.round(impressions),
            ctr: numberOrNull(row?.ctr),
            position: numberOrNull(row?.position),
        },
    };
}

async function takeToken(clientId: string, service: 'ga4' | 'gsc', deps: LiveDeps): Promise<{ ok: true; token: string; creds: Record<string, unknown> } | LiveFailure> {
    try {
        const auth = await deps.getToken(clientId, service);
        if (!auth) {
            return {
                ok: false,
                status: 404,
                error: service === 'ga4' ? 'GA4 is not connected' : 'Search Console is not connected',
                code: 'not_connected',
            };
        }
        return { ok: true, token: auth.token, creds: auth.creds };
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            if (error.kind === 'reauth_required') {
                return { ok: false, status: 401, error: 'Google authorization expired. Reconnect this integration.', code: 'reauth_required' };
            }
            return { ok: false, status: 503, error: 'Google authorization is temporarily unavailable', code: 'upstream' };
        }
        return { ok: false, status: 503, error: 'Google authorization is temporarily unavailable', code: 'upstream' };
    }
}

function metricAt(report: { rows?: { metricValues?: { value?: string }[] }[] }, index: number): number | null {
    const raw = report?.rows?.[0]?.metricValues?.[index]?.value;
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
