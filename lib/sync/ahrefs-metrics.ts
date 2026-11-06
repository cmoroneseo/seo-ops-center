/**
 * Ahrefs numbers that were not measured stay null.
 * `Number(null)` is 0, so this parser never calls Number on null or blank
 * input and never uses `|| 0` or `?? 0`. A real 0 stays 0.
 */
export function ahrefsNullableNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Domain Rating is a 0–100 score. Missing, blank, and non-numeric stay null. */
export function mapAhrefsDomainRating(body: unknown): number | null {
    if (!body || typeof body !== 'object') return null;
    const root = (body as { domain_rating?: unknown }).domain_rating;
    const raw = root && typeof root === 'object' && !Array.isArray(root)
        ? (root as { domain_rating?: unknown }).domain_rating
        : root;
    const rating = ahrefsNullableNumber(raw);
    return rating == null ? null : Math.round(rating);
}

export interface AhrefsKeywordMetrics {
    /** Monthly searches. Null when Ahrefs did not measure volume. */
    volume: number | null;
    /** Keyword Difficulty on the 0–100 scale. Null when unmeasured. */
    keywordDifficulty: number | null;
}

/** Volume and keyword difficulty from one organic-keywords or rank-tracker row. */
export function mapAhrefsKeywordMetrics(row: unknown): AhrefsKeywordMetrics {
    if (!row || typeof row !== 'object') return { volume: null, keywordDifficulty: null };
    const record = row as { volume?: unknown; keyword_difficulty?: unknown };
    return {
        volume: ahrefsNullableNumber(record.volume),
        keywordDifficulty: ahrefsNullableNumber(record.keyword_difficulty),
    };
}

/**
 * Organic Keywords returns at most this many rows. The API default is the
 * same number, so omitting `limit` does not lift the cap.
 */
export const AHREFS_ORGANIC_ROW_CAP = 1000;

/**
 * The 1,000-row cap is off unless this is exactly `true`.
 * Off: the request does not send `limit=1000`, and a full page is not stored
 * as a complete keyword census.
 * On: send the cap and store that page's counts, including a full page.
 */
export function ahrefsOrganicRowCapEnabled(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return env.AHREFS_ORGANIC_ROW_CAP === 'true';
}

export interface OrganicKeywordCounts {
    ranked_keywords: number | null;
    top_10_keywords: number | null;
    top_20_keywords: number | null;
    top_50_keywords: number | null;
}

const EMPTY_KEYWORD_COUNTS: OrganicKeywordCounts = {
    ranked_keywords: null,
    top_10_keywords: null,
    top_20_keywords: null,
    top_50_keywords: null,
};

function positionAtMost(value: unknown, max: number): boolean {
    const position = ahrefsNullableNumber(value);
    return position != null && position <= max;
}

/**
 * Tier counts from one organic-keywords page. A page that fills the cap is
 * not a complete census unless the cap flag is on.
 */
export function organicKeywordCounts(
    keywords: unknown,
    capEnabled: boolean,
): OrganicKeywordCounts {
    const rows = Array.isArray(keywords) ? keywords : [];
    if (rows.length >= AHREFS_ORGANIC_ROW_CAP && !capEnabled) return EMPTY_KEYWORD_COUNTS;
    const inTier = (row: unknown, max: number) => {
        if (!row || typeof row !== 'object') return false;
        const record = row as { best_position?: unknown; best_position_prev?: unknown };
        return positionAtMost(record.best_position, max) || positionAtMost(record.best_position_prev, max);
    };
    return {
        ranked_keywords: rows.length,
        top_10_keywords: rows.filter(row => inTier(row, 10)).length,
        top_20_keywords: rows.filter(row => inTier(row, 20)).length,
        top_50_keywords: rows.filter(row => inTier(row, 50)).length,
    };
}
