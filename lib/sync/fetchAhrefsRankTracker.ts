import { createAdminClient } from '@/lib/supabase/admin';

export interface RankTrackerRow {
    keyword: string;
    /** End-of-period position, or null if not ranking in top 100. */
    position: number | null;
    /** Start-of-period position, or null if not ranking then. */
    positionPrev: number | null;
    /** positionPrev - position: positive = moved up (improved), negative = moved down. */
    positionDiff: number | null;
    volume: number | null;
    url: string | null;
    /** e.g. "Corona, California, United States" — set when the project tracks multiple locations. */
    location: string | null;
    /** Only populated when requested via options.columns. */
    traffic: number | null;
    keywordDifficulty: number | null;
}

export type RankTrackerResult =
    | { status: 'not_configured' }
    | { status: 'error'; message: string }
    | { status: 'ok'; rows: RankTrackerRow[] };

export type RankTrackerSortField = 'traffic' | 'volume' | 'position' | 'keyword_difficulty';

export interface RankTrackerOptions {
    device?: 'desktop' | 'mobile';
    limit?: number;
    sortBy?: RankTrackerSortField;
    sortDir?: 'asc' | 'desc';
    /** Extra optional columns to fetch beyond the always-included core set. */
    columns?: ('traffic' | 'keyword_difficulty')[];
}

/**
 * Pull tracked-keyword positions for a client's Ahrefs Rank Tracker project,
 * comparing start vs end of the given date range. We don't manage the
 * keyword list ourselves — it's whatever the agency already tracks in the
 * Ahrefs Rank Tracker project connected via Settings.
 *
 * This is fetched live per report view (not stored), since Ahrefs already
 * retains the position history — no need to snapshot it ourselves.
 *
 * Verified live against a real project which of the endpoint's query params
 * actually take effect vs. are silently ignored:
 *   - device, limit, order_by: genuinely respected
 *   - tag / position_from / position_to / url / serp_features / location /
 *     country as FILTERS: silently ignored (still return everything) — not
 *     exposed as options here for that reason. `location` is only usable as
 *     an output column via `select`, not a filter.
 */
export async function fetchAhrefsRankTracker(
    clientId: string,
    dateStart: string, // 'YYYY-MM-DD'
    dateEnd: string,   // 'YYYY-MM-DD'
    opts: RankTrackerOptions = {},
): Promise<RankTrackerResult> {
    const admin = createAdminClient();
    // No sync_status filter — that field reflects the domain-metrics fetch
    // (fetchAhrefs.ts), a separate feature. Rank Tracker just needs its own
    // credentials to be present, regardless of whether the other one is erroring.
    const { data: row } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', 'ahrefs')
        .maybeSingle();

    const creds = (row?.credentials ?? {}) as Record<string, any>;
    const apiKey = creds.api_key as string | undefined;
    const projectId = creds.rank_tracker_project_id as string | undefined;
    if (!apiKey || !projectId) return { status: 'not_configured' };

    const device = opts.device ?? 'desktop';
    const limit = opts.limit ?? 100;
    const sortBy = opts.sortBy ?? 'traffic';
    const sortDir = opts.sortDir ?? 'desc';
    const extraColumns = opts.columns ?? [];

    const select = ['keyword', 'position', 'position_prev', 'volume', 'url', 'location', ...extraColumns].join(',');

    const params = new URLSearchParams({
        date: dateEnd,
        date_compared: dateStart,
        device,
        limit: String(limit),
        order_by: `${sortBy}:${sortDir}`,
        project_id: projectId,
        select,
    });

    const res = await fetch(`https://api.ahrefs.com/v3/rank-tracker/overview?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
        const text = await res.text();
        return { status: 'error', message: `Ahrefs API error: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    const keywords: any[] = data.overviews ?? [];

    const rows: RankTrackerRow[] = keywords.map(k => {
        const position = k.position ?? null;
        const positionPrev = k.position_prev ?? null;
        const positionDiff = position != null && positionPrev != null ? positionPrev - position : null;
        return {
            keyword: k.keyword,
            position,
            positionPrev,
            positionDiff,
            volume: k.volume ?? null,
            url: k.url ?? null,
            location: k.location ?? null,
            traffic: k.traffic ?? null,
            keywordDifficulty: k.keyword_difficulty ?? null,
        };
    });

    return { status: 'ok', rows };
}
