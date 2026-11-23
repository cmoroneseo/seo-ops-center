import { normalizeResultUrl } from '@/lib/search-reporting/result-url';

import { isGbpTaggedUrl, pageMatchesChange } from './match';
import type { DayPoint } from './types';
import { normalizeQuery } from './validate';

export interface HistoryDayRow {
    id: string;
    date: string;
    preliminary: boolean;
    pageLimited?: boolean;
}

export interface GscFactRow {
    dayId: string;
    grain: string;
    page: string;
    query: string;
    clicks: number;
    impressions: number;
    position: number;
    surface: string | null;
}

export interface Ga4PageRow {
    date: string;
    path: string;
    organicSessions: number | null;
    keyEvents: number | null;
    preliminary: boolean;
}

export interface Ga4SiteRow {
    date: string;
    organicSessions: number | null;
    keyEvents: number | null;
    preliminary: boolean;
}

function finite(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function isOrganicSurface(surface: string | null): boolean {
    return surface == null || surface === '' || surface === 'organic';
}

/** Page-grain organic rows for the logged URLs, one point per day. */
export function pageDaysFromFacts(
    days: readonly HistoryDayRow[],
    facts: readonly GscFactRow[],
    loggedUrls: readonly string[],
): DayPoint[] {
    return groupFactDays(days, facts.filter(fact => fact.grain === 'page' && isOrganicSurface(fact.surface)
        && loggedUrls.some(url => pageMatchesChange(fact.page, url))));
}

/** Search Console keeps tag variants. GA4 strips the query string and includes GBP in the same landing page. */
export function gbpDaysFromFacts(
    days: readonly HistoryDayRow[],
    facts: readonly GscFactRow[],
    loggedUrls: readonly string[],
): DayPoint[] {
    const keys = new Set(loggedUrls.map(normalizeResultUrl));
    const dayIds = new Set(days.map(day => day.id));
    const tagged = facts.filter(fact => dayIds.has(fact.dayId) && fact.grain === 'page' && isGbpTaggedUrl(fact.page)
        && keys.has(normalizeResultUrl(fact.page)) && !loggedUrls.some(url => pageMatchesChange(fact.page, url)));
    if (tagged.length === 0) return [];
    const measured = groupFactDays(days, tagged);
    const seen = new Set(measured.map(day => day.date));
    // An absent variant is zero only when the day has a complete page-grain import.
    for (const day of days) {
        if (day.preliminary || day.pageLimited !== false || seen.has(day.date)) continue;
        measured.push({
            date: day.date, clicks: 0, impressions: 0, position: 0,
            organicSessions: null, keyEvents: null, preliminary: false,
        });
    }
    return measured;
}

function groupFactDays(days: readonly HistoryDayRow[], facts: readonly GscFactRow[]): DayPoint[] {
    const byId = new Map(days.map(day => [day.id, day]));
    const grouped = new Map<string, { clicks: number; impressions: number; weighted: number; preliminary: boolean }>();
    for (const fact of facts) {
        const day = byId.get(fact.dayId);
        if (!day) continue;
        const current = grouped.get(day.date) ?? { clicks: 0, impressions: 0, weighted: 0, preliminary: day.preliminary };
        current.clicks += finite(fact.clicks);
        current.impressions += finite(fact.impressions);
        current.weighted += finite(fact.position) * finite(fact.impressions);
        current.preliminary = current.preliminary || day.preliminary;
        grouped.set(day.date, current);
    }
    return [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, row]) => ({
            date,
            clicks: row.clicks,
            impressions: row.impressions,
            position: row.impressions > 0 ? row.weighted / row.impressions : 0,
            organicSessions: null,
            keyEvents: null,
            preliminary: row.preliminary,
        }));
}

export function propertyDaysFromFacts(days: readonly HistoryDayRow[], facts: readonly GscFactRow[]): DayPoint[] {
    const byId = new Map(days.map(day => [day.id, day]));
    const grouped = new Map<string, DayPoint>();
    for (const fact of facts) {
        if (fact.grain !== 'property' || !isOrganicSurface(fact.surface)) continue;
        const day = byId.get(fact.dayId);
        if (!day) continue;
        const current = grouped.get(day.date) ?? {
            date: day.date,
            clicks: 0,
            impressions: 0,
            position: 0,
            organicSessions: null,
            keyEvents: null,
            preliminary: day.preliminary,
        };
        const impressions = current.impressions + finite(fact.impressions);
        const weighted = current.position * current.impressions + finite(fact.position) * finite(fact.impressions);
        current.clicks += finite(fact.clicks);
        current.impressions = impressions;
        current.position = impressions > 0 ? weighted / impressions : 0;
        current.preliminary = current.preliminary || day.preliminary;
        grouped.set(day.date, current);
    }
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function queryDaysFromFacts(
    days: readonly HistoryDayRow[],
    facts: readonly GscFactRow[],
    loggedUrls: readonly string[],
    query: string,
): DayPoint[] {
    const needle = normalizeQuery(query);
    return groupFactDays(days, facts.filter(fact => fact.grain === 'query_page' && isOrganicSurface(fact.surface)
        && normalizeQuery(fact.query) === needle && loggedUrls.some(url => pageMatchesChange(fact.page, url))));
}

/** Fold GA4 landing-page rows onto GSC days. A GA4-only day is still kept. */
export function mergeGa4(points: DayPoint[], rows: readonly Ga4PageRow[], paths: readonly string[]): DayPoint[] {
    const wanted = new Set(paths);
    const byDate = new Map(points.map(point => [point.date, { ...point }]));
    for (const row of rows) {
        if (!wanted.has(row.path)) continue;
        const current = byDate.get(row.date) ?? {
            date: row.date,
            clicks: 0,
            impressions: 0,
            position: 0,
            organicSessions: null,
            keyEvents: null,
            preliminary: row.preliminary,
        };
        current.organicSessions = add(current.organicSessions, row.organicSessions);
        current.keyEvents = add(current.keyEvents, row.keyEvents);
        current.preliminary = current.preliminary || row.preliminary;
        byDate.set(row.date, current);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeGa4Site(points: DayPoint[], rows: readonly Ga4SiteRow[]): DayPoint[] {
    const byDate = new Map(points.map(point => [point.date, { ...point }]));
    for (const row of rows) {
        const current = byDate.get(row.date) ?? {
            date: row.date,
            clicks: 0,
            impressions: 0,
            position: 0,
            organicSessions: null,
            keyEvents: null,
            preliminary: row.preliminary,
        };
        current.organicSessions = row.organicSessions;
        current.keyEvents = row.keyEvents;
        current.preliminary = current.preliminary || row.preliminary;
        byDate.set(row.date, current);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function add(current: number | null, next: number | null): number | null {
    if (current == null) return next;
    if (next == null) return current;
    return current + next;
}

export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    if (error.code === '42P01' || error.code === 'PGRST205') return true;
    const message = error.message ?? '';
    return /seo_change/i.test(message) && /does not exist|schema cache/i.test(message) && !/test_kind|treatment/i.test(message);
}

/** Migration 129 has not been applied, so test_kind / treatment are not columns yet. */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    const message = error.message ?? '';
    if (!/test_kind|treatment/i.test(message)) return false;
    return error.code === '42703' || error.code === 'PGRST204' || /does not exist|schema cache|could not find/i.test(message);
}
