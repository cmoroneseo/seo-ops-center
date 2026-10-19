/**
 * What a live URL earned in Search Console from its ship date through today.
 *
 * The headline is that window's totals. When the URL already had rows before
 * it shipped, the comparison is the equal-length calendar window immediately
 * before the ship date (missing days count as zero). If that before window
 * runs past the days the sync actually fetched, the comparison switches to
 * per-day averages so a shorter before window is not treated as a smaller total.
 */

import { dateOffset } from '@/lib/gsc/history';
import { sumMetrics } from './metrics';
import { inclusiveDays } from './range';

export const TOP_RESULT_QUERIES = 3;
/** GSC keeps about 16 months. Live URL fetches stay inside that. */
export const LIVE_URL_RETENTION_DAYS = 480;
export const NOT_INDEXED_COPY = 'Not indexed yet';

const COUNT = new Intl.NumberFormat('en-US');

export interface UrlMetricRow {
    date: string;
    clicks: number;
    impressions: number;
    position: number;
}

export interface UrlQueryRow {
    query: string;
    clicks: number;
    impressions: number;
    position: number;
}

export interface UrlResultTotals {
    clicks: number;
    impressions: number;
    position: number | null;
}

export interface UrlResultComparison {
    basis: 'equal_window' | 'per_day';
    days: number;
    beforeDays: number;
    before: UrlResultTotals;
    after: UrlResultTotals;
    label: string;
}

export interface UrlResultQuery {
    query: string;
    clicks: number;
    impressions: number;
}

export type UrlResultReadout =
    | { kind: 'hidden' }
    | { kind: 'not_indexed' }
    | {
        kind: 'measured';
        clicks: number;
        impressions: number;
        position: number | null;
        queries: UrlResultQuery[];
        comparison: UrlResultComparison | null;
    };

export interface LiveUrlWindows {
    afterStart: string;
    afterEnd: string;
    beforeStart: string;
    beforeEnd: string;
    coverageStart: string;
    coverageEnd: string;
}

export function liveUrlCoverage(goLive: string, today: string): LiveUrlWindows | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(goLive) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || goLive > today) return null;
    const earliest = dateOffset(today, -(LIVE_URL_RETENTION_DAYS - 1));
    const afterEnd = today;
    const afterStart = goLive < earliest ? earliest : goLive;
    const afterDays = inclusiveDays(afterStart, afterEnd);
    const beforeEnd = dateOffset(goLive, -1);
    const idealBeforeStart = dateOffset(beforeEnd, -(afterDays - 1));
    const beforeStart = idealBeforeStart < earliest ? earliest : idealBeforeStart;
    const coverageStart = beforeEnd < earliest ? afterStart : beforeStart;
    return { afterStart, afterEnd, beforeStart, beforeEnd, coverageStart, coverageEnd: afterEnd };
}

function totalsOf(rows: UrlMetricRow[]): UrlResultTotals {
    const totals = sumMetrics(rows);
    return { clicks: totals.clicks, impressions: totals.impressions, position: totals.position };
}

function rate(clicks: number, days: number): string {
    if (days <= 0) return '0.0';
    return (clicks / days).toFixed(1);
}

function equalLabel(before: UrlResultTotals): string {
    return `before ${COUNT.format(before.clicks)} clicks · ${COUNT.format(before.impressions)} impr`;
}

function perDayLabel(before: UrlResultTotals, beforeDays: number, after: UrlResultTotals, afterDays: number): string {
    return `${rate(before.clicks, beforeDays)} → ${rate(after.clicks, afterDays)} clicks/day`;
}

function topQueries(rows: readonly UrlQueryRow[]): UrlResultQuery[] {
    const byQuery = new Map<string, { clicks: number; impressions: number; weighted: number }>();
    for (const row of rows) {
        const query = row.query.trim();
        if (!query) continue;
        const current = byQuery.get(query) ?? { clicks: 0, impressions: 0, weighted: 0 };
        current.clicks += row.clicks;
        current.impressions += row.impressions;
        current.weighted += row.position * row.impressions;
        byQuery.set(query, current);
    }
    return [...byQuery.entries()]
        .map(([query, totals]) => ({ query, clicks: totals.clicks, impressions: totals.impressions }))
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.query.localeCompare(b.query))
        .slice(0, TOP_RESULT_QUERIES);
}

export function summarizeUrlResult(input: {
    connected: boolean;
    checked: boolean;
    goLive: string;
    today: string;
    rows: readonly UrlMetricRow[];
    queries: readonly UrlQueryRow[];
    /** Earliest day this sync asked Search Console for. Null means the rows already cover the windows. */
    coverageStart?: string | null;
}): UrlResultReadout {
    if (!input.connected || !input.checked) return { kind: 'hidden' };
    const windows = liveUrlCoverage(input.goLive, input.today);
    if (!windows) return { kind: 'hidden' };
    if (input.rows.length === 0 && input.queries.length === 0) return { kind: 'not_indexed' };

    const afterRows = input.rows.filter(row => row.date >= windows.afterStart && row.date <= windows.afterEnd);
    const after = totalsOf(afterRows);
    const afterDays = inclusiveDays(windows.afterStart, windows.afterEnd);
    const coveredBeforeStart = input.coverageStart && input.coverageStart > windows.beforeStart
        ? input.coverageStart
        : windows.beforeStart;
    const beforeRows = coveredBeforeStart <= windows.beforeEnd
        ? input.rows.filter(row => row.date >= coveredBeforeStart && row.date <= windows.beforeEnd && row.date < input.goLive)
        : [];
    const beforeDays = coveredBeforeStart <= windows.beforeEnd ? inclusiveDays(coveredBeforeStart, windows.beforeEnd) : 0;
    let comparison: UrlResultComparison | null = null;
    if (beforeRows.length > 0 && beforeDays > 0 && afterDays > 0) {
        const before = totalsOf(beforeRows);
        const basis = beforeDays === afterDays ? 'equal_window' : 'per_day';
        comparison = {
            basis,
            days: afterDays,
            beforeDays,
            before,
            after,
            label: basis === 'equal_window' ? equalLabel(before) : perDayLabel(before, beforeDays, after, afterDays),
        };
    }

    return {
        kind: 'measured',
        clicks: after.clicks,
        impressions: after.impressions,
        position: after.position,
        queries: topQueries(input.queries),
        comparison,
    };
}

export function aggregateUrlResults(items: readonly UrlResultReadout[]): UrlResultReadout {
    const visible = items.filter(item => item.kind !== 'hidden');
    if (visible.length === 0) return { kind: 'hidden' };
    const measured = visible.filter(item => item.kind === 'measured');
    if (measured.length === 0) return { kind: 'not_indexed' };
    const totals = sumMetrics(measured.map(item => ({
        clicks: item.clicks,
        impressions: item.impressions,
        position: item.position ?? 0,
    })));
    const comparisons = measured.flatMap(item => item.comparison ? [item.comparison] : []);
    const everyMeasuredHasComparison = comparisons.length === measured.length;
    let comparison: UrlResultComparison | null = null;
    if (everyMeasuredHasComparison && comparisons.length > 0) {
        const before = sumMetrics(comparisons.map(item => ({
            clicks: item.before.clicks,
            impressions: item.before.impressions,
            position: item.before.position ?? 0,
        })));
        const after = sumMetrics(comparisons.map(item => ({
            clicks: item.after.clicks,
            impressions: item.after.impressions,
            position: item.after.position ?? 0,
        })));
        const beforeTotals = { clicks: before.clicks, impressions: before.impressions, position: before.position };
        const afterTotals = { clicks: after.clicks, impressions: after.impressions, position: after.position };
        const equal = comparisons.every(item => item.basis === 'equal_window');
        const beforeDays = comparisons.reduce((sum, item) => sum + item.beforeDays, 0);
        const afterDays = comparisons.reduce((sum, item) => sum + item.days, 0);
        comparison = {
            basis: equal ? 'equal_window' : 'per_day',
            days: afterDays,
            beforeDays,
            before: beforeTotals,
            after: afterTotals,
            label: equal ? equalLabel(beforeTotals) : perDayLabel(beforeTotals, beforeDays, afterTotals, afterDays),
        };
    }
    return {
        kind: 'measured',
        clicks: totals.clicks,
        impressions: totals.impressions,
        position: totals.position,
        queries: topQueries(measured.flatMap(item => item.queries.map(query => ({
            query: query.query,
            clicks: query.clicks,
            impressions: query.impressions,
            position: 0,
        })))),
        comparison,
    };
}

export function urlResultCopy(result: UrlResultReadout | null | undefined): string | null {
    if (!result || result.kind === 'hidden') return null;
    if (result.kind === 'not_indexed') return NOT_INDEXED_COPY;
    const position = result.position == null ? '—' : result.position.toFixed(1);
    const parts = [
        `${COUNT.format(result.clicks)} clicks`,
        `${COUNT.format(result.impressions)} impr`,
        `pos ${position}`,
    ];
    if (result.queries.length > 0) parts.push(result.queries.map(query => query.query).join(', '));
    if (result.comparison) parts.push(result.comparison.label);
    return parts.join(' · ');
}
