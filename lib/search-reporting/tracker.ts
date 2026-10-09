import { NOT_COLLECTED_DETAIL, NOT_COLLECTED_REASON } from './types';
import type { AhrefsReferenceRow, TrackerPair } from './types';

/** Positions further apart than this disagree. A missing side is not an anomaly. */
export const TRACKER_DISAGREEMENT_GAP = 5;

export function normalizeTrackerQuery(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function trackerDisagrees(trackerPosition: number | null, gscPosition: number | null): boolean {
    if (trackerPosition == null || gscPosition == null) return false;
    return Math.abs(trackerPosition - gscPosition) > TRACKER_DISAGREEMENT_GAP;
}

export function ahrefsReferenceRows(data: unknown): AhrefsReferenceRow[] {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const keywords = (data as { keywords?: unknown }).keywords;
    if (!Array.isArray(keywords)) return [];
    const rows: AhrefsReferenceRow[] = [];
    for (const item of keywords) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const query = typeof record.query === 'string' ? record.query : typeof record.keyword === 'string' ? record.keyword : '';
        if (!query.trim()) continue;
        const raw = record.position ?? record.best_position;
        const position = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
        rows.push({ query: query.trim(), position });
    }
    return rows;
}

export function compareAhrefs(
    gscOrganic: { query: string; position: number | null }[],
    ahrefs: AhrefsReferenceRow[],
): TrackerPair[] {
    const gsc = new Map<string, number | null>();
    for (const row of gscOrganic) {
        const key = normalizeTrackerQuery(row.query);
        if (!key || gsc.has(key)) continue;
        gsc.set(key, row.position);
    }
    return ahrefs.map(row => {
        const key = normalizeTrackerQuery(row.query);
        const gscOrganicPosition = gsc.has(key) ? gsc.get(key) ?? null : null;
        return {
            query: row.query,
            tracker: 'ahrefs' as const,
            trackerPosition: row.position,
            gscOrganicPosition,
            anomalyOpen: trackerDisagrees(row.position, gscOrganicPosition),
        };
    });
}

export const DFS_SPOT_CHECK_SLOT = {
    audience: 'staff' as const,
    source: 'DataForSEO' as const,
    tag: 'snapshot' as const,
    available: false as const,
    rows: [] as TrackerPair[],
    value: null,
    state: 'partial' as const,
    reason: NOT_COLLECTED_REASON,
    detail: NOT_COLLECTED_DETAIL,
};

export function cityTokensFromCustomFields(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const fields = value as Record<string, unknown>;
    const raw = fields.service_cities ?? fields.cities;
    const values = typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : [];
    return values.filter((token): token is string => typeof token === 'string' && token.trim().length >= 3).map(token => token.trim());
}
