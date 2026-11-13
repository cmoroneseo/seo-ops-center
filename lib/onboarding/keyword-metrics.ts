/**
 * Keyword rows shown while setting up a client's topic map.
 * The only measured number is where the site ranks, from Google Search Console.
 * A disconnected or failed source never becomes 0, and guessed numbers are dropped.
 */

import { MAX_SEED_KEYWORDS, normalizeSeedKeywords } from '../topical-map/seed-keywords';

export const SEARCH_CONSOLE_POSITION_NOTE = 'Not available: connect Google Search Console';

/** Shown under the column header when Search Console is not connected. */
export const NEEDS_SEARCH_CONSOLE = 'Needs Google Search Console';

export const POSITION_FAILED_NOTE = 'Your current position could not be loaded.';

/** Search Console is connected but has no data for this search. Never "Not in top 100": we do not know that. */
export const NOT_SHOWING_YET = 'Not showing in Google yet';

export type MetricSource = 'connected' | 'missing' | 'failed';

/** Search Console average position as a rank and the Google results page it lands on. */
export function rankParts(position: number): { rank: number; page: number } {
    const rank = Math.max(1, Math.round(position));
    return { rank, page: Math.ceil(rank / 10) };
}

export interface MetricCell {
    text: string;
    note: string | null;
}

export function measuredNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A missing or failed source is always a dash, even when a caller passes a number.
 * A connected Search Console with no data for the search says so in words.
 */
export function keywordPositionCell(value: number | null, source: MetricSource): MetricCell {
    if (source === 'missing') return { text: '—', note: SEARCH_CONSOLE_POSITION_NOTE };
    if (source === 'failed') return { text: '—', note: POSITION_FAILED_NOTE };
    if (value == null || !Number.isFinite(value) || value <= 0) return { text: NOT_SHOWING_YET, note: null };
    const { rank, page } = rankParts(value);
    return { text: `#${rank} · page ${page} of Google`, note: null };
}

/**
 * Why a keyword is on the list, only where we hold the data that says so.
 * AI ideas have no reason we can back up, so they carry none.
 */
export type KeywordReason = 'added' | 'saved';

export function keywordReasonText(reason: KeywordReason): string {
    return reason === 'added' ? 'You added this' : 'Chosen earlier';
}

export interface KeywordRow {
    keyword: string;
    position: number | null;
    selected: boolean;
    reason?: KeywordReason | null;
}

/** Footer hint on the keyword step. Continue always works, even without Search Console. */
export function keywordStepHint(searchConsole: MetricSource): string {
    return searchConsole === 'missing'
        ? 'You can continue without it. Rankings fill in once Google Search Console is connected.'
        : 'You can change keywords later from the topic map.';
}

/** True when at least one row has a reason backed by data, so the column is worth showing. */
export function hasKeywordReasons(rows: readonly KeywordRow[]): boolean {
    return rows.some(row => row.reason != null);
}

/** Same cap as generation, so a keyword past it is never silently dropped later. */
export const KEYWORD_LIMIT = MAX_SEED_KEYWORDS;
export const KEYWORD_LIMIT_MESSAGE = `You can choose up to ${KEYWORD_LIMIT} keywords. Uncheck one to add another.`;

/** Keep the phrase only. Any monthly searches or difficulty this source returns are guesses. */
export function ideaKeywords(body: unknown): string[] {
    if (!body || typeof body !== 'object') return [];
    const keywords = (body as { keywords?: unknown }).keywords;
    if (!Array.isArray(keywords)) return [];
    return keywords.flatMap(row => {
        if (!row || typeof row !== 'object') return [];
        const keyword = (row as { keyword?: unknown }).keyword;
        return typeof keyword === 'string' && keyword.trim() ? [keyword] : [];
    });
}

export function buildKeywordRows(input: {
    ideas: readonly string[];
    positions: readonly { query: string; position: number }[];
    saved: readonly string[];
    selectionTouched: boolean;
    searchConsole: MetricSource;
}): { rows: KeywordRow[]; truncated: boolean } {
    const saved = normalizeSeedKeywords(input.saved);
    const savedSet = new Set(saved.map(keyword => keyword.toLowerCase()));
    const useSavedSelection = input.selectionTouched || saved.length > 0;
    const map = new Map<string, { keyword: string; reason: KeywordReason | null }>();

    const take = (keyword: string, reason: KeywordReason | null) => {
        const clean = normalizeSeedKeywords([keyword])[0];
        if (!clean) return;
        const key = clean.toLowerCase();
        if (!map.has(key)) map.set(key, { keyword: clean, reason });
    };

    for (const keyword of saved) take(keyword, 'saved');
    for (const keyword of input.ideas) take(keyword, null);

    const positions = new Map<string, number>();
    if (input.searchConsole === 'connected') {
        for (const entry of input.positions) {
            const key = entry.query.trim().toLowerCase();
            if (!key || positions.has(key)) continue;
            const position = measuredNumber(entry.position);
            if (position == null || position <= 0) continue;
            positions.set(key, position);
        }
    }

    const all = [...map.values()];
    return {
        truncated: all.length > KEYWORD_LIMIT,
        rows: all.slice(0, KEYWORD_LIMIT).map(row => ({
            keyword: row.keyword,
            position: input.searchConsole === 'connected' ? positions.get(row.keyword.toLowerCase()) ?? null : null,
            selected: useSavedSelection ? savedSet.has(row.keyword.toLowerCase()) : true,
            reason: row.reason,
        })),
    };
}

export function addKeywordRow(rows: readonly KeywordRow[], raw: string): { rows: KeywordRow[]; error: string | null } {
    const keyword = normalizeSeedKeywords([raw])[0];
    if (!keyword) {
        const trimmed = raw.trim();
        if (!trimmed) return { rows: [...rows], error: 'Enter a keyword.' };
        return { rows: [...rows], error: 'Use a shorter keyword.' };
    }
    const key = keyword.toLowerCase();
    const existing = rows.find(row => row.keyword.toLowerCase() === key);
    if (existing) {
        return {
            rows: rows.map(row => row.keyword.toLowerCase() === key ? { ...row, selected: true } : row),
            error: null,
        };
    }
    const added: KeywordRow = { keyword, position: null, selected: true, reason: 'added' };
    if (rows.length < KEYWORD_LIMIT) return { rows: [added, ...rows], error: null };

    // The list is full. Make room by dropping the last suggestion nobody kept.
    let drop = -1;
    for (let index = rows.length - 1; index >= 0; index--) {
        if (!rows[index].selected) { drop = index; break; }
    }
    if (drop === -1) return { rows: [...rows], error: KEYWORD_LIMIT_MESSAGE };
    return { rows: [added, ...rows.filter((_, index) => index !== drop)], error: null };
}
