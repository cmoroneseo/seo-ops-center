/**
 * GSC cannibalization for tracked keywords.
 *
 * A keyword is affected when at least MIN_COMPETING_URLS distinct normalized
 * organic URLs each have at least MIN_URL_IMPRESSIONS impressions in the
 * current Rankings window. Fragments and utm_* parameters collapse through
 * normalizeUrl. A gbp_link URL is a separate class and does not compete.
 *
 * Health is 1 - affected/tracked. Zero tracked keywords, or a window that
 * was not read, is not measurable. Missing impressions and position stay
 * null. They are never stored as 0.
 */

import { sumMetrics } from '../search-reporting/metrics';
import { normalizeTrackerQuery } from '../search-reporting/tracker';
import { normalizeUrl } from '../url/normalize-url';

/** Impressions a normalized organic URL needs before it counts as competing. */
export const MIN_URL_IMPRESSIONS = 1;

/** Distinct competing organic URLs required before a tracked keyword is affected. */
export const MIN_COMPETING_URLS = 2;

export const CANNIBAL_DEFINITION =
    'A keyword is affected when 2 or more normalized URLs each have impressions.';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CannibalFact {
    date: string;
    query: string;
    page: string;
    clicks: number | null;
    impressions: number | null;
    position: number | null;
    /** Other grains are ignored. Omitted rows are treated as query_page. */
    grain?: string;
}

export interface CannibalUrl {
    url: string;
    /** Null when any contributing row is missing clicks. Never a stand-in for a missing value. */
    clicks: number | null;
    impressions: number;
    /** Null when position cannot be weighted. Never a stand-in for a missing value. */
    avgPosition: number | null;
}

export interface CannibalKeyword {
    id: string;
    keyword: string;
    urls: CannibalUrl[];
}

export interface CannibalizationReport {
    tracked: number;
    /** Null when the ratio was not measured. */
    affected: number | null;
    /** 1 - affected/tracked. Null when tracked is 0 or the window was not read. */
    health: number | null;
    keywords: CannibalKeyword[];
}

export interface CannibalWindow {
    start: string;
    end: string;
}

function finiteNonNegative(value: number | null): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validWindow(window: CannibalWindow): boolean {
    return ISO_DATE.test(window.start) && ISO_DATE.test(window.end) && window.start <= window.end;
}

export function unmeasuredCannibalization(tracked: number): CannibalizationReport {
    return { tracked, affected: null, health: null, keywords: [] };
}

/** Whole percents stay whole. Any other measured ratio keeps one decimal. */
export function formatCannibalHealth(health: number | null): string {
    if (health == null || !Number.isFinite(health)) return 'not measurable';
    const percent = Math.round(health * 1000) / 10;
    if (!Number.isFinite(percent)) return 'not measurable';
    return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

function aggregate(rows: readonly CannibalFact[]): {
    clicks: number | null;
    impressions: number | null;
    avgPosition: number | null;
} {
    if (rows.length === 0 || rows.some(row => !finiteNonNegative(row.impressions))) {
        return { clicks: null, impressions: null, avgPosition: null };
    }
    const impressions = rows.reduce((sum, row) => sum + (row.impressions as number), 0);
    const clicks = rows.every(row => finiteNonNegative(row.clicks))
        ? rows.reduce((sum, row) => sum + (row.clicks as number), 0)
        : null;
    if (impressions <= 0 || rows.some(row => !finiteNonNegative(row.position))) {
        return { clicks, impressions, avgPosition: null };
    }
    const totals = sumMetrics(rows.map(row => ({
        clicks: row.clicks as number,
        impressions: row.impressions as number,
        position: row.position as number,
    })));
    return { clicks, impressions, avgPosition: totals.position };
}

function competingUrls(
    facts: readonly CannibalFact[],
    normalizedKey: string,
    current: CannibalWindow,
): CannibalUrl[] {
    if (!normalizedKey) return [];
    const groups = new Map<string, CannibalFact[]>();
    for (const fact of facts) {
        if (fact.grain != null && fact.grain !== 'query_page') continue;
        if (!ISO_DATE.test(fact.date) || fact.date < current.start || fact.date > current.end) continue;
        if (normalizeTrackerQuery(fact.query) !== normalizedKey) continue;
        const normalized = normalizeUrl(fact.page);
        if (!normalized || normalized.surface !== 'organic') continue;
        const list = groups.get(normalized.url);
        if (list) list.push(fact);
        else groups.set(normalized.url, [fact]);
    }
    const urls: CannibalUrl[] = [];
    for (const [url, rows] of groups) {
        const metrics = aggregate(rows);
        if (metrics.impressions == null || metrics.impressions < MIN_URL_IMPRESSIONS) continue;
        urls.push({
            url,
            clicks: metrics.clicks,
            impressions: metrics.impressions,
            avgPosition: metrics.avgPosition,
        });
    }
    return urls.sort((a, b) => b.impressions - a.impressions || a.url.localeCompare(b.url));
}

export function keywordCannibalization(input: {
    keywords: readonly { id: string; keyword: string }[];
    facts: readonly CannibalFact[];
    current: CannibalWindow;
    /** False when the current window was not read. Facts are ignored. */
    measured: boolean;
}): CannibalizationReport {
    const tracked = input.keywords.length;
    if (!input.measured || tracked === 0 || !validWindow(input.current)) {
        return unmeasuredCannibalization(tracked);
    }
    const keywords = input.keywords.flatMap(keyword => {
        const urls = competingUrls(input.facts, normalizeTrackerQuery(keyword.keyword), input.current);
        if (urls.length < MIN_COMPETING_URLS) return [];
        return [{ id: keyword.id, keyword: keyword.keyword, urls }];
    }).sort((a, b) => b.urls[0].impressions - a.urls[0].impressions || a.keyword.localeCompare(b.keyword));
    return {
        tracked,
        affected: keywords.length,
        health: 1 - keywords.length / tracked,
        keywords,
    };
}
