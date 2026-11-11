/**
 * Keyword numbers shown while setting up a client.
 * A disconnected or failed source never becomes 0, and guessed numbers are dropped.
 */

import { normalizeSeedKeywords } from '../topical-map/seed-keywords';

export const AHREFS_SEARCHES_NOTE = 'Connect Ahrefs to see monthly searches';
export const AHREFS_DIFFICULTY_NOTE = 'Connect Ahrefs to see how hard each search is';
export const SEARCH_CONSOLE_POSITION_NOTE = 'Connect Search Console to see your current position';

export const SEARCHES_FAILED_NOTE = 'Monthly searches could not be loaded.';
export const DIFFICULTY_FAILED_NOTE = 'Difficulty could not be loaded.';
export const POSITION_FAILED_NOTE = 'Your current position could not be loaded.';

export const SEARCHES_UNMEASURED_NOTE = 'Monthly searches were not measured for this keyword';
export const DIFFICULTY_UNMEASURED_NOTE = 'Difficulty was not measured for this keyword';
export const POSITION_UNMEASURED_NOTE = 'Not in recent Search Console data';

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

const UNMEASURED_NOTE: Record<MetricKind, string> = {
    volume: SEARCHES_UNMEASURED_NOTE,
    difficulty: DIFFICULTY_UNMEASURED_NOTE,
    position: POSITION_UNMEASURED_NOTE,
};

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
        const rounded = Math.round(value * 10) / 10;
        return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    }
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

/**
 * A missing or failed source is always a dash, even when a caller passes 0 or a guess.
 * A connected source shows a measured number, including a real 0.
 */
export function keywordMetricCell(value: number | null, source: MetricSource, kind: MetricKind): MetricCell {
    if (source === 'missing') return { text: '—', note: MISSING_NOTE[kind] };
    if (source === 'failed') return { text: '—', note: FAILED_NOTE[kind] };
    if (value == null || !Number.isFinite(value) || (kind === 'position' && value <= 0)) {
        return { text: '—', note: UNMEASURED_NOTE[kind] };
    }
    return { text: formatMeasured(value, kind), note: null };
}

export function keywordSourceNotes(ahrefs: MetricSource, searchConsole: MetricSource): string[] {
    const notes: string[] = [];
    if (ahrefs === 'missing') notes.push(AHREFS_SEARCHES_NOTE, AHREFS_DIFFICULTY_NOTE);
    else if (ahrefs === 'failed') notes.push(SEARCHES_FAILED_NOTE, DIFFICULTY_FAILED_NOTE);
    if (searchConsole === 'missing') notes.push(SEARCH_CONSOLE_POSITION_NOTE);
    else if (searchConsole === 'failed') notes.push(POSITION_FAILED_NOTE);
    return notes;
}

export interface KeywordRow {
    keyword: string;
    volume: number | null;
    difficulty: number | null;
    position: number | null;
    selected: boolean;
}

export interface RawKeyword {
    keyword: string;
    volume?: unknown;
    difficulty?: unknown;
}

const KEYWORD_LIMIT = 40;

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
    const map = new Map<string, { keyword: string; volume: number | null; difficulty: number | null }>();

    const take = (keyword: string, volume: unknown, difficulty: unknown, allowMetrics: boolean) => {
        const clean = normalizeSeedKeywords([keyword])[0];
        if (!clean) return;
        const key = clean.toLowerCase();
        const nextVolume = allowMetrics && metricsOn ? measuredNumber(volume) : null;
        const nextDifficulty = allowMetrics && metricsOn ? measuredNumber(difficulty) : null;
        const existing = map.get(key);
        if (!existing) {
            map.set(key, { keyword: clean, volume: nextVolume, difficulty: nextDifficulty });
            return;
        }
        if (existing.volume == null && nextVolume != null) existing.volume = nextVolume;
        if (existing.difficulty == null && nextDifficulty != null) existing.difficulty = nextDifficulty;
    };

    for (const keyword of saved) take(keyword, null, null, false);
    for (const row of input.site) take(row.keyword, row.volume, row.difficulty, true);
    for (const row of input.rivals) take(row.keyword, row.volume, row.difficulty, true);
    for (const row of input.ideas) take(row.keyword, row.volume, row.difficulty, false);

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
    return {
        rows: [{ keyword, volume: null, difficulty: null, position: null, selected: true }, ...rows],
        error: null,
    };
}
