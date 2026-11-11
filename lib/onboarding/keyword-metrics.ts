/**
 * Keyword numbers shown while setting up a client.
 * A disconnected or failed source never becomes 0, and guessed numbers are dropped.
 */

import { MAX_SEED_KEYWORDS, normalizeSeedKeywords } from '../topical-map/seed-keywords';

export const AHREFS_SEARCHES_NOTE = 'Not available: connect Ahrefs';
export const AHREFS_DIFFICULTY_NOTE = 'Not available: connect Ahrefs';
export const SEARCH_CONSOLE_POSITION_NOTE = 'Not available: connect Google Search Console';

/** Shown under a column header when its source is not connected. */
export const NEEDS_AHREFS = 'Needs Ahrefs';
export const NEEDS_SEARCH_CONSOLE = 'Needs Google Search Console';

export const SEARCHES_FAILED_NOTE = 'Monthly searches could not be loaded.';
export const DIFFICULTY_FAILED_NOTE = 'Difficulty could not be loaded.';
export const POSITION_FAILED_NOTE = 'Your current position could not be loaded.';

export const SEARCHES_UNMEASURED_NOTE = 'Monthly searches were not measured for this keyword';
export const DIFFICULTY_UNMEASURED_NOTE = 'Difficulty was not measured for this keyword';
/** Search Console is connected but has no data for this search. Never "Not in top 100": we do not know that. */
export const NOT_SHOWING_YET = 'Not showing in Google yet';

export type MetricSource = 'connected' | 'missing' | 'failed';
export type MetricKind = 'volume' | 'difficulty' | 'position';

const MISSING_NOTE: Record<MetricKind, string> = {
    volume: AHREFS_SEARCHES_NOTE,
    difficulty: AHREFS_DIFFICULTY_NOTE,
    position: SEARCH_CONSOLE_POSITION_NOTE,
};

const FAILED_NOTE: Record<MetricKind, string> = {
    volume: SEARCHES_FAILED_NOTE,
    difficulty: DIFFICULTY_FAILED_NOTE,
    position: POSITION_FAILED_NOTE,
};

const UNMEASURED_NOTE: Record<Exclude<MetricKind, 'position'>, string> = {
    volume: SEARCHES_UNMEASURED_NOTE,
    difficulty: DIFFICULTY_UNMEASURED_NOTE,
};

export type DifficultyBand = 'Easy' | 'Medium' | 'Hard';

/** Easy 0–29 · Medium 30–59 · Hard 60–100. */
export function difficultyBand(score: number): { band: DifficultyBand; level: 1 | 2 | 3; score: number } {
    const clamped = Math.min(100, Math.max(0, Math.round(score)));
    if (clamped < 30) return { band: 'Easy', level: 1, score: clamped };
    if (clamped < 60) return { band: 'Medium', level: 2, score: clamped };
    return { band: 'Hard', level: 3, score: clamped };
}

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

export function formatMeasured(value: number, kind: MetricKind): string {
    if (kind === 'position') {
        const { rank, page } = rankParts(value);
        return `#${rank} · page ${page} of Google`;
    }
    if (kind === 'difficulty') {
        const { band, score } = difficultyBand(value);
        return `${band} ${score}/100`;
    }
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

/**
 * A missing or failed source is always a dash, even when a caller passes 0 or a guess.
 * A connected source shows a measured number, including a real 0. A connected
 * Search Console with no data for the search says so in words.
 */
export function keywordMetricCell(value: number | null, source: MetricSource, kind: MetricKind): MetricCell {
    if (source === 'missing') return { text: '—', note: MISSING_NOTE[kind] };
    if (source === 'failed') return { text: '—', note: FAILED_NOTE[kind] };
    if (kind === 'position') {
        if (value == null || !Number.isFinite(value) || value <= 0) return { text: NOT_SHOWING_YET, note: null };
        return { text: formatMeasured(value, kind), note: null };
    }
    if (value == null || !Number.isFinite(value)) return { text: '—', note: UNMEASURED_NOTE[kind] };
    return { text: formatMeasured(value, kind), note: null };
}

/**
 * Why a keyword is on the list, only where we hold the data that says so.
 * AI ideas have no reason we can back up, so they carry none.
 */
export type KeywordReason = 'added' | 'site' | 'competitor' | 'saved';

export function keywordReasonText(reason: KeywordReason): string {
    switch (reason) {
        case 'added':
            return 'You added this';
        case 'site':
            return 'Your site already ranks for this';
        case 'competitor':
            return "On a competitor's site";
        case 'saved':
            return 'Chosen earlier';
    }
}

export interface KeywordRow {
    keyword: string;
    volume: number | null;
    difficulty: number | null;
    position: number | null;
    selected: boolean;
    reason?: KeywordReason | null;
    /** The competitor domain, when the reason is "competitor". */
    competitor?: string | null;
}

export interface RawKeyword {
    keyword: string;
    volume?: unknown;
    difficulty?: unknown;
    /** Set on competitor rows: the domain Ahrefs found it on. */
    competitor?: string;
}

/** Footer hint on the keyword step. Continue always works, even with a tool missing. */
export function keywordStepHint(ahrefs: MetricSource, searchConsole: MetricSource): string {
    return ahrefs === 'missing' || searchConsole === 'missing'
        ? 'You can continue without these. The numbers fill in once the tools are connected.'
        : 'You can change keywords later from the topic map.';
}

/** True when at least one row has a reason backed by data, so the column is worth showing. */
export function hasKeywordReasons(rows: readonly KeywordRow[]): boolean {
    return rows.some(row => row.reason != null);
}

/** Same cap as generation, so a keyword past it is never silently dropped later. */
export const KEYWORD_LIMIT = MAX_SEED_KEYWORDS;
export const KEYWORD_LIMIT_MESSAGE = `You can choose up to ${KEYWORD_LIMIT} keywords. Uncheck one to add another.`;

export function ahrefsKeywordRows(body: unknown): RawKeyword[] {
    if (!body || typeof body !== 'object') return [];
    const keywords = (body as { keywords?: unknown }).keywords;
    if (!Array.isArray(keywords)) return [];
    return keywords.flatMap(row => {
        if (!row || typeof row !== 'object') return [];
        const keyword = (row as { keyword?: unknown }).keyword;
        if (typeof keyword !== 'string' || !keyword.trim()) return [];
        return [{
            keyword,
            volume: (row as { volume?: unknown }).volume,
            difficulty: (row as { difficulty?: unknown }).difficulty,
        }];
    });
}

/** Keep the phrase. Drop monthly searches and difficulty, which this source guesses. */
export function ideaKeywordRows(body: unknown): RawKeyword[] {
    return ahrefsKeywordRows(body).map(row => ({ keyword: row.keyword }));
}

export function ahrefsSourceFromStatus(status: number): MetricSource {
    if (status === 404) return 'missing';
    if (status === 200 || status === 400) return 'connected';
    return 'failed';
}

export function buildKeywordRows(input: {
    site: readonly RawKeyword[];
    rivals: readonly RawKeyword[];
    ideas: readonly RawKeyword[];
    positions: readonly { query: string; position: number }[];
    saved: readonly string[];
    selectionTouched: boolean;
    ahrefs: MetricSource;
    searchConsole: MetricSource;
}): { rows: KeywordRow[]; truncated: boolean } {
    const saved = normalizeSeedKeywords(input.saved);
    const savedSet = new Set(saved.map(keyword => keyword.toLowerCase()));
    const useSavedSelection = input.selectionTouched || saved.length > 0;
    const metricsOn = input.ahrefs === 'connected';
    type Entry = {
        keyword: string;
        volume: number | null;
        difficulty: number | null;
        reason: KeywordReason | null;
        competitor: string | null;
    };
    const map = new Map<string, Entry>();
    // Ahrefs data about this site or a rival says more than "chosen earlier".
    const strength = (reason: KeywordReason | null) => reason === 'site' ? 3 : reason === 'competitor' ? 2 : reason === 'saved' ? 1 : 0;

    const take = (
        keyword: string,
        volume: unknown,
        difficulty: unknown,
        allowMetrics: boolean,
        reason: KeywordReason | null,
        competitor: string | null = null,
    ) => {
        const clean = normalizeSeedKeywords([keyword])[0];
        if (!clean) return;
        const key = clean.toLowerCase();
        const nextVolume = allowMetrics && metricsOn ? measuredNumber(volume) : null;
        const nextDifficulty = allowMetrics && metricsOn ? measuredNumber(difficulty) : null;
        const existing = map.get(key);
        if (!existing) {
            map.set(key, { keyword: clean, volume: nextVolume, difficulty: nextDifficulty, reason, competitor });
            return;
        }
        if (existing.volume == null && nextVolume != null) existing.volume = nextVolume;
        if (existing.difficulty == null && nextDifficulty != null) existing.difficulty = nextDifficulty;
        if (strength(reason) > strength(existing.reason)) {
            existing.reason = reason;
            existing.competitor = competitor;
        }
    };

    for (const keyword of saved) take(keyword, null, null, false, 'saved');
    for (const row of input.site) take(row.keyword, row.volume, row.difficulty, true, 'site');
    for (const row of input.rivals) take(row.keyword, row.volume, row.difficulty, true, 'competitor', row.competitor?.trim() || null);
    for (const row of input.ideas) take(row.keyword, row.volume, row.difficulty, false, null);

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
            volume: metricsOn ? row.volume : null,
            difficulty: metricsOn ? row.difficulty : null,
            position: input.searchConsole === 'connected' ? positions.get(row.keyword.toLowerCase()) ?? null : null,
            selected: useSavedSelection ? savedSet.has(row.keyword.toLowerCase()) : true,
            reason: row.reason,
            competitor: row.competitor,
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
    const added: KeywordRow = { keyword, volume: null, difficulty: null, position: null, selected: true, reason: 'added' };
    if (rows.length < KEYWORD_LIMIT) return { rows: [added, ...rows], error: null };

    // The list is full. Make room by dropping the last suggestion nobody kept.
    let drop = -1;
    for (let index = rows.length - 1; index >= 0; index--) {
        if (!rows[index].selected) { drop = index; break; }
    }
    if (drop === -1) return { rows: [...rows], error: KEYWORD_LIMIT_MESSAGE };
    return { rows: [added, ...rows.filter((_, index) => index !== drop)], error: null };
}
