/**
 * Search dashboard view model.
 *
 * One page, three sources. Windows are the Search Insights / Rankings pair:
 * 28 days ending on the last final day, then the 28 days before that.
 * Metrics come from stored GSC property rows, ga4_daily, and Bing tables.
 * Missing measurements stay null. Users are not a GA metric. Bing is never
 * added into GSC or GA totals.
 */

import {
    BING_CONNECTED_NO_DATA_TITLE,
    BING_GAP_LABEL,
    bingPosition,
    displayPage,
    type BingGap,
    type BingLinkInput,
} from '@/lib/agency-dashboard/bing';
import { dateOffset } from '@/lib/gsc/history';
import { safePageUrl, summarizePerformance, type HistoryDay, type HistoryRow } from '@/lib/gsc/insights';
import { formatDelta, type DeltaTone, type FormattedDelta } from '@/lib/reporting/delta';
import { comparisonDistortion, coverWindow, eachDate, lastFinalDate, rollingSpan, type DateSpan } from '@/lib/search-reporting/range';

export const SEARCH_SOURCES = ['gsc', 'ga', 'bing'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

export const SOURCE_LABEL: Record<SearchSource, string> = {
    gsc: 'Google Search Console',
    ga: 'Google Analytics',
    bing: 'Bing Webmaster',
};

export interface DayFlag {
    date: string;
    isIncomplete: boolean;
}

export interface PairedWindow {
    current: DateSpan;
    prior: DateSpan;
    comparable: boolean;
}

export interface PeriodMetrics {
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    position: number | null;
}

export const EMPTY_PERIOD: PeriodMetrics = {
    clicks: null,
    impressions: null,
    ctr: null,
    position: null,
};

export interface GaPeriod {
    organicSessions: number | null;
    sessions: number | null;
    engagedSessions: number | null;
    engagementRate: number | null;
    keyEvents: number | null;
}

export interface Ga4DailyRow {
    date: string;
    isFinal: boolean;
    organicSessions: number | null;
    sessions: number | null;
    engagedSessions: number | null;
    keyEvents: number | null;
}

export interface ChartPoint {
    date: string;
    clicks?: number | null;
    impressions?: number | null;
    position?: number | null;
    organicSessions?: number | null;
    sessions?: number | null;
    keyEvents?: number | null;
}

export interface GscToggles {
    clicks: boolean;
    impressions: boolean;
    position: boolean;
}

export interface GaToggles {
    sessions: boolean;
    keyEvents: boolean;
}

export type GscSeriesId = 'clicks' | 'impressions' | 'position';
export type GaSeriesId = 'organicSessions' | 'sessions' | 'keyEvents';
export type SeriesId = GscSeriesId | GaSeriesId;

export interface ChartSeries {
    id: SeriesId;
    label: string;
    color: string;
    axis: 'left' | 'right' | 'alt';
}

export interface KpiCell {
    id: string;
    label: string;
    value: string;
    tone: DeltaTone | null;
    title?: string;
}

export interface InsightQueryRow {
    query: string;
    topPage: string;
    position: number | null;
    clicks: number;
    impressions: number;
}

export interface InsightPageRow {
    page: string;
    position: number | null;
    clicks: number;
    impressions: number;
}

export interface BingToggles {
    clicks: boolean;
    impressions: boolean;
}

export interface BingTrafficDay {
    date: string;
    clicks: number;
    impressions: number;
    queriesComplete: boolean;
    pagesComplete: boolean;
}

export interface BingQueryWeek {
    weekEnding: string;
    query: string;
    clicks: number;
    impressions: number;
    /** AvgImpressionPosition. Null when Bing omitted it. Never AvgClickPosition. */
    avgImpressionPosition: number | null;
    stale: boolean;
}

export interface BingPageWeek {
    weekEnding: string;
    page: string;
    clicks: number;
    impressions: number;
    avgImpressionPosition: number | null;
}

export interface BingListRow {
    label: string;
    clicks: number;
    impressions: number;
    position: number | null;
}

export interface BingGapState {
    label: string;
    title: string | null;
}

export interface BingDashboard {
    gap: BingGapState | null;
    syncWarning: string | null;
    kpis: KpiCell[];
    points: ChartPoint[];
    queries: BingListRow[];
    pages: BingListRow[];
    queriesNote: string | null;
    pagesNote: string | null;
    hiddenQueries: number;
    hiddenPages: number;
}

export const SERIES_LABEL: Record<SeriesId, string> = {
    clicks: 'Clicks',
    impressions: 'Impressions',
    position: 'Avg position',
    organicSessions: 'Organic sessions',
    sessions: 'Sessions',
    keyEvents: 'Key events',
};

/** Distinct series colors. Clicks/organic stay on the brand chart token; the second series does not. */
export const SERIES_COLOR: Record<SeriesId, string> = {
    clicks: 'var(--chart-1)',
    impressions: 'var(--chart-4)',
    position: 'var(--chart-3)',
    organicSessions: 'var(--chart-1)',
    sessions: 'var(--chart-3)',
    keyEvents: '#34d399',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const BING_CLICKS_COLOR = '#2dd4bf';
export const BING_IMPRESSIONS_COLOR = '#a78bfa';

export function visibleSources(bing: boolean): SearchSource[] {
    return bing ? ['gsc', 'ga', 'bing'] : ['gsc', 'ga'];
}

export function defaultSearchSource(input: { gsc: boolean; ga: boolean; bing: boolean }): SearchSource | null {
    if (input.gsc) return 'gsc';
    if (input.ga) return 'ga';
    if (input.bing) return 'bing';
    return null;
}

export function sourceConnections(rows: readonly {
    service: string;
    syncStatus: string;
    selectedProperty?: string;
    needsPropertySetup?: boolean;
}[]): { gsc: boolean; ga: boolean } {
    const live = (service: string) => rows.filter(row => row.service === service && row.syncStatus !== 'disconnected' && row.syncStatus !== 'pending_setup');
    return {
        gsc: live('gsc').some(row => Boolean(row.selectedProperty)),
        ga: live('ga4').some(row => row.needsPropertySetup !== true),
    };
}

export function historyChunks(today: string): DateSpan[] {
    return [
        { start: dateOffset(today, -30), end: today },
        { start: dateOffset(today, -61), end: dateOffset(today, -31) },
    ];
}

/** Last final day, then the prior 28. Comparable only when both windows have the same final coverage. */
export function pairedWindows(days: readonly DayFlag[], today: string): PairedWindow | null {
    const flags = days.map(day => ({ date: day.date, isIncomplete: day.isIncomplete }));
    const end = lastFinalDate(flags, today);
    if (!end) return null;
    const current = rollingSpan(end);
    const prior = rollingSpan(dateOffset(current.start, -1));
    const distortion = comparisonDistortion(coverWindow(current, flags), coverWindow(prior, flags));
    return { current, prior, comparable: !distortion.distorted };
}

function dateParts(iso: string): { year: number; month: number; day: number } | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatSpan(start: string, end: string): string {
    const a = dateParts(start);
    const b = dateParts(end);
    if (!a || !b) return `${start}–${end}`;
    const left = MONTHS[a.month - 1] ?? start;
    const right = MONTHS[b.month - 1] ?? end;
    if (a.year === b.year && a.month === b.month) return `${left} ${a.day}–${b.day}`;
    if (a.year === b.year) return `${left} ${a.day}–${right} ${b.day}`;
    return `${left} ${a.day}, ${a.year}–${right} ${b.day}, ${b.year}`;
}

export function windowChip(window: PairedWindow | null): string {
    if (!window) return 'Last 28 days';
    return `Last 28 days · ${formatSpan(window.current.start, window.current.end)} vs ${formatSpan(window.prior.start, window.prior.end)}`;
}

export function compareCaption(window: PairedWindow | null): string {
    if (!window) return 'The 28-day compare appears once a final day is stored.';
    return `Current ${formatSpan(window.current.start, window.current.end)} vs prior ${formatSpan(window.prior.start, window.prior.end)}`;
}

export function formatCount(value: number | null, compactFrom = 10_000): string {
    if (value == null || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value);
    if (Math.abs(rounded) >= compactFrom) {
        const thousands = rounded / 1000;
        const digits = Math.abs(thousands) >= 100 ? 0 : 1;
        const text = thousands.toFixed(digits).replace(/\.0$/, '');
        return `${text}k`;
    }
    return rounded.toLocaleString('en-US');
}

export function formatPosition(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return (Math.round(value * 10) / 10).toFixed(1);
}

export function formatPercent(ratio: number | null): string {
    if (ratio == null || !Number.isFinite(ratio)) return '—';
    const percent = Math.round(ratio * 1000) / 10;
    return Number.isInteger(percent) ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;
}

export function propertySeries(days: readonly HistoryDay[], rows: readonly HistoryRow[], span: DateSpan): ChartPoint[] {
    const rowsByDay = new Map<string, HistoryRow[]>();
    for (const row of rows) {
        const list = rowsByDay.get(row.dayId);
        if (list) list.push(row);
        else rowsByDay.set(row.dayId, [row]);
    }
    const byDate = new Map(days.map(day => [day.date, day]));
    return eachDate(span.start, span.end).map(date => {
        const day = byDate.get(date);
        if (!day || day.isIncomplete) return { date, clicks: null, impressions: null, position: null };
        const dayRows = rowsByDay.get(day.id) ?? [];
        if (dayRows.length === 0) return { date, clicks: null, impressions: null, position: null };
        const totals = summarizePerformance(dayRows);
        return { date, clicks: totals.clicks, impressions: totals.impressions, position: totals.position };
    });
}

export function periodMetrics(points: readonly ChartPoint[]): PeriodMetrics {
    let clicks = 0;
    let impressions = 0;
    let positionWeight = 0;
    let measured = false;
    for (const point of points) {
        if (point.clicks == null || point.impressions == null) continue;
        measured = true;
        clicks += point.clicks;
        impressions += point.impressions;
        if (point.position != null && point.impressions > 0) positionWeight += point.position * point.impressions;
    }
    if (!measured) return EMPTY_PERIOD;
    return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : null,
        position: impressions > 0 ? Math.round((positionWeight / impressions) * 10) / 10 : null,
    };
}

function finiteMetric(value: unknown): number | null {
    if (typeof value === 'string' && value.trim()) value = Number(value);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return value;
}

/** Reads ga4_daily fields only. A users column on the payload is ignored. */
export function readGa4DailyPayload(value: unknown): Ga4DailyRow | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const date = typeof record.day === 'string' ? record.day.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const nested = Array.isArray(record.ga4_daily) ? record.ga4_daily[0] : record.ga4_daily;
    const metrics = nested && typeof nested === 'object' ? nested as Record<string, unknown> : {};
    return {
        date,
        isFinal: record.is_final === true,
        organicSessions: finiteMetric(metrics.organic_sessions),
        sessions: finiteMetric(metrics.sessions),
        engagedSessions: finiteMetric(metrics.engaged_sessions),
        keyEvents: finiteMetric(metrics.key_events),
    };
}

export function dedupeGa4Days(rows: readonly Ga4DailyRow[]): Ga4DailyRow[] {
    const byDate = new Map<string, Ga4DailyRow>();
    for (const row of rows) {
        const current = byDate.get(row.date);
        if (!current || (!current.isFinal && row.isFinal)) byDate.set(row.date, row);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function gaSeries(rows: readonly Ga4DailyRow[], span: DateSpan): ChartPoint[] {
    const byDate = new Map(rows.map(row => [row.date, row]));
    return eachDate(span.start, span.end).map(date => {
        const row = byDate.get(date);
        if (!row || !row.isFinal) return { date, organicSessions: null, sessions: null, keyEvents: null };
        return {
            date,
            organicSessions: row.organicSessions,
            sessions: row.sessions,
            keyEvents: row.keyEvents,
        };
    });
}

export function gaPeriod(rows: readonly Ga4DailyRow[], span: DateSpan): GaPeriod {
    const inSpan = rows.filter(row => row.isFinal && row.date >= span.start && row.date <= span.end);
    const sum = (key: 'organicSessions' | 'sessions' | 'engagedSessions' | 'keyEvents'): number | null => {
        const values = inSpan.map(row => row[key]).filter((value): value is number => value != null);
        if (values.length === 0) return null;
        return values.reduce((total, value) => total + value, 0);
    };
    const sessions = sum('sessions');
    const engagedSessions = sum('engagedSessions');
    return {
        organicSessions: sum('organicSessions'),
        sessions,
        engagedSessions,
        keyEvents: sum('keyEvents'),
        engagementRate: sessions != null && engagedSessions != null && sessions > 0 ? engagedSessions / sessions : null,
    };
}

export function gscPlottedSeries(toggles: GscToggles): GscSeriesId[] {
    const plotted: GscSeriesId[] = [];
    if (toggles.clicks) plotted.push('clicks');
    if (toggles.impressions) plotted.push('impressions');
    if (toggles.position) plotted.push('position');
    return plotted;
}

export function gaPlottedSeries(toggles: GaToggles): GaSeriesId[] {
    const plotted: GaSeriesId[] = ['organicSessions'];
    if (toggles.sessions) plotted.push('sessions');
    if (toggles.keyEvents) plotted.push('keyEvents');
    return plotted;
}

export function seriesAxis(id: string, plotted: readonly string[]): ChartSeries['axis'] {
    if (plotted[0] === id) return 'left';
    if (plotted[1] === id) return 'right';
    return 'alt';
}

export function chartSeries(ids: readonly SeriesId[]): ChartSeries[] {
    return ids.map(id => ({
        id,
        label: SERIES_LABEL[id],
        color: SERIES_COLOR[id],
        axis: seriesAxis(id, ids),
    }));
}

export function gscChartSeries(toggles: GscToggles): ChartSeries[] {
    return chartSeries(gscPlottedSeries(toggles));
}

export function gaChartSeries(toggles: GaToggles): ChartSeries[] {
    return chartSeries(gaPlottedSeries(toggles));
}

/** True when clicks and impressions are both drawn, which is the dual-axis case. */
export function gscDualAxis(toggles: GscToggles): boolean {
    return toggles.clicks && toggles.impressions;
}

export function drawsBothAxes(series: readonly ChartSeries[]): boolean {
    return series.some(item => item.axis === 'left') && series.some(item => item.axis !== 'left');
}

export function pointValue(point: ChartPoint, id: string): number | null {
    const value = (point as unknown as Record<string, unknown>)[id];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function seriesHasValues(points: readonly ChartPoint[], series: readonly ChartSeries[]): boolean {
    return series.some(item => points.some(point => pointValue(point, item.id) != null));
}

export function seriesLegend(series: ChartSeries): string {
    return series.axis === 'left' ? series.label : `${series.label} (right axis)`;
}

function vsPriorText(delta: FormattedDelta): { text: string; tone: DeltaTone } | null {
    if (delta.kind !== 'change' && delta.kind !== 'noise') return null;
    if (delta.percent != null && delta.direction) {
        const arrow = delta.direction === 'up' ? '↑' : '↓';
        return { text: `${arrow} ${Math.abs(delta.percent).toFixed(0)}%`, tone: delta.tone };
    }
    return { text: delta.text, tone: delta.tone };
}

export function gscKpis(current: PeriodMetrics, prior: PeriodMetrics | null): KpiCell[] {
    const cells: KpiCell[] = [
        { id: 'clicks', label: 'Clicks', value: formatCount(current.clicks), tone: null },
        { id: 'impressions', label: 'Impressions', value: formatCount(current.impressions), tone: null },
        { id: 'position', label: 'Avg position', value: formatPosition(current.position), tone: null },
        { id: 'ctr', label: 'CTR', value: formatPercent(current.ctr), tone: null },
    ];
    const delta = prior
        ? formatDelta(current.clicks, prior.clicks, { metric: 'count', audience: 'staff', presentation: 'reporting' })
        : null;
    const vs = delta ? vsPriorText(delta) : null;
    cells.push({
        id: 'vs-prior',
        label: 'vs prior',
        value: vs?.text ?? '—',
        tone: vs?.tone ?? null,
        title: 'Clicks versus the prior 28 days',
    });
    return cells;
}

export function gaKpis(current: GaPeriod | null): KpiCell[] {
    return [
        { id: 'organicSessions', label: 'Organic sessions', value: formatCount(current?.organicSessions ?? null), tone: null },
        { id: 'sessions', label: 'Sessions', value: formatCount(current?.sessions ?? null), tone: null },
        { id: 'engagedSessions', label: 'Engaged sessions', value: formatCount(current?.engagedSessions ?? null), tone: null },
        { id: 'engagementRate', label: 'Engagement rate', value: formatPercent(current?.engagementRate ?? null), tone: null },
        { id: 'keyEvents', label: 'Key events', value: formatCount(current?.keyEvents ?? null), tone: null },
    ];
}

export function pageLabel(page: string): string {
    const safe = safePageUrl(page);
    if (!safe) return page;
    try {
        const url = new URL(safe);
        const path = `${url.pathname}${url.search}` || '/';
        return path.length > 72 ? `${path.slice(0, 71)}…` : path;
    } catch {
        return page;
    }
}

export function insightQueries(rows: readonly { query: string; page: string; clicks: number; impressions: number; position: number }[], limit = 50): { rows: InsightQueryRow[]; hidden: number } {
    const best = new Map<string, { query: string; page: string; clicks: number; impressions: number; position: number }>();
    for (const row of rows) {
        const current = best.get(row.query);
        if (!current || row.impressions > current.impressions) best.set(row.query, row);
    }
    const sorted = [...best.values()].sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
    return {
        hidden: Math.max(0, sorted.length - limit),
        rows: sorted.slice(0, limit).map(row => ({
            query: row.query,
            topPage: pageLabel(row.page),
            position: row.position,
            clicks: row.clicks,
            impressions: row.impressions,
        })),
    };
}

export function insightPages(rows: readonly { page: string; clicks: number; impressions: number; position: number }[], limit = 50): { rows: InsightPageRow[]; hidden: number } {
    const sorted = [...rows].sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));
    return {
        hidden: Math.max(0, sorted.length - limit),
        rows: sorted.slice(0, limit).map(row => ({
            page: pageLabel(row.page),
            position: row.position,
            clicks: row.clicks,
            impressions: row.impressions,
        })),
    };
}

function cell(id: string, label: string, value: string, tone: DeltaTone | null = null, title?: string): KpiCell {
    return { id, label, value, tone, title };
}

export function bingDualAxis(toggles: BingToggles): boolean {
    return toggles.clicks && toggles.impressions;
}

export function bingChartSeries(toggles: BingToggles): ChartSeries[] {
    const ids: Array<'clicks' | 'impressions'> = [];
    if (toggles.clicks) ids.push('clicks');
    if (toggles.impressions) ids.push('impressions');
    return ids.map(id => ({
        id,
        label: SERIES_LABEL[id],
        color: id === 'clicks' ? BING_CLICKS_COLOR : BING_IMPRESSIONS_COLOR,
        axis: seriesAxis(id, ids),
    }));
}

function inSpan(date: string, span: DateSpan): boolean {
    return date >= span.start && date <= span.end;
}

export function bingSeries(days: readonly BingTrafficDay[], span: DateSpan): ChartPoint[] {
    const byDate = new Map(days.map(day => [day.date, day]));
    return eachDate(span.start, span.end).map(date => {
        const day = byDate.get(date);
        if (!day) return { date, clicks: null, impressions: null };
        return { date, clicks: day.clicks, impressions: day.impressions };
    });
}

/** Impression-weighted AvgImpressionPosition. Missing positions are left out, not counted as 0. */
export function bingWeeklyPosition(rows: readonly { impressions: number; avgImpressionPosition: number | null }[]): number | null {
    let weight = 0;
    let impressions = 0;
    for (const row of rows) {
        if (row.avgImpressionPosition == null || row.impressions <= 0) continue;
        weight += row.avgImpressionPosition * row.impressions;
        impressions += row.impressions;
    }
    if (impressions <= 0) return null;
    return bingPosition(weight, impressions);
}

function trafficTotals(days: readonly BingTrafficDay[]): { clicks: number | null; impressions: number | null; ctr: number | null; days: number } {
    if (days.length === 0) return { clicks: null, impressions: null, ctr: null, days: 0 };
    const clicks = days.reduce((sum, day) => sum + day.clicks, 0);
    const impressions = days.reduce((sum, day) => sum + day.impressions, 0);
    return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : null,
        days: days.length,
    };
}

function aggregateWeeks<T extends { clicks: number; impressions: number; avgImpressionPosition: number | null }>(
    rows: readonly T[],
    labelOf: (row: T) => string,
    limit: number,
): { rows: BingListRow[]; hidden: number } {
    const grouped = new Map<string, { clicks: number; impressions: number; weight: number; weightImpressions: number }>();
    for (const row of rows) {
        if (row.clicks < 0 || row.impressions < 0) continue;
        const label = labelOf(row);
        const current = grouped.get(label) ?? { clicks: 0, impressions: 0, weight: 0, weightImpressions: 0 };
        current.clicks += row.clicks;
        current.impressions += row.impressions;
        if (row.avgImpressionPosition != null && row.avgImpressionPosition >= 0 && row.impressions > 0) {
            current.weight += row.avgImpressionPosition * row.impressions;
            current.weightImpressions += row.impressions;
        }
        grouped.set(label, current);
    }
    const ranked = [...grouped.entries()]
        .filter(([, value]) => value.clicks > 0)
        .sort((a, b) => b[1].clicks - a[1].clicks || a[0].localeCompare(b[0]));
    return {
        hidden: Math.max(0, ranked.length - limit),
        rows: ranked.slice(0, limit).map(([label, value]) => ({
            label,
            clicks: value.clicks,
            impressions: value.impressions,
            position: value.weightImpressions > 0 ? value.weight / value.weightImpressions : null,
        })),
    };
}

export function bingGap(input: {
    unavailable: boolean;
    link: Pick<BingLinkInput, 'syncStatus' | 'lastSyncedAt'> | null;
    hasRangeData: boolean;
}): BingGapState | null {
    if (input.unavailable) return { label: BING_GAP_LABEL.unavailable, title: null };
    if (input.hasRangeData && input.link) return null;
    let reason: BingGap = 'not_connected';
    if (input.link) {
        if (input.link.syncStatus === 'error' && !input.link.lastSyncedAt) reason = 'sync_error';
        else if (!input.link.lastSyncedAt) reason = 'not_synced';
        else if (input.link.syncStatus === 'error') reason = 'sync_error';
        else reason = 'no_data';
    }
    return {
        label: BING_GAP_LABEL[reason],
        title: reason === 'no_data' ? BING_CONNECTED_NO_DATA_TITLE : null,
    };
}

export function buildBingDashboard(input: {
    unavailable?: boolean;
    link: Pick<BingLinkInput, 'syncStatus' | 'lastSyncedAt'> | null;
    traffic: readonly BingTrafficDay[];
    queries: readonly BingQueryWeek[];
    pages: readonly BingPageWeek[];
    window: PairedWindow | null;
    limit?: number;
    listTruncated?: boolean;
}): BingDashboard {
    const limit = input.limit ?? 50;
    const empty: BingDashboard = {
        gap: bingGap({ unavailable: input.unavailable === true, link: input.link, hasRangeData: false }),
        syncWarning: null,
        kpis: [],
        points: [],
        queries: [],
        pages: [],
        queriesNote: null,
        pagesNote: null,
        hiddenQueries: 0,
        hiddenPages: 0,
    };
    if (!input.window || input.unavailable || !input.link) return empty;
    const currentDays = input.traffic.filter(day => inSpan(day.date, input.window!.current));
    const priorDays = input.traffic.filter(day => inSpan(day.date, input.window!.prior));
    const currentQueries = input.queries.filter(row => inSpan(row.weekEnding, input.window!.current));
    const position = bingWeeklyPosition(currentQueries);
    const hasRangeData = currentDays.length > 0 || position != null;
    const gap = bingGap({ unavailable: false, link: input.link, hasRangeData });
    if (gap) return { ...empty, gap };
    const current = trafficTotals(currentDays);
    const prior = trafficTotals(priorDays);
    const priorFull = prior.days >= 28 && input.window.comparable;
    const delta = priorFull
        ? formatDelta(current.clicks, prior.clicks, { metric: 'count', audience: 'staff', presentation: 'reporting' })
        : null;
    const vs = delta ? vsPriorText(delta) : null;
    const queryIncomplete = input.listTruncated === true || currentDays.some(day => !day.queriesComplete) || currentQueries.some(row => row.stale);
    const pagesIncomplete = currentDays.some(day => !day.pagesComplete);
    const queryTable = aggregateWeeks(currentQueries, row => row.query, limit);
    const pageTable = aggregateWeeks(
        input.pages.filter(row => inSpan(row.weekEnding, input.window!.current)),
        row => row.page,
        limit,
    );
    pageTable.rows = pageTable.rows.map(row => ({ ...row, label: displayPage(row.label) }));
    return {
        gap: null,
        syncWarning: input.link.syncStatus === 'error' ? 'Last sync failed' : null,
        kpis: [
            cell('clicks', 'Clicks', formatCount(current.clicks)),
            cell('impressions', 'Impressions', formatCount(current.impressions)),
            cell('ctr', 'CTR', formatPercent(current.ctr)),
            cell('position', 'Avg position · weekly', formatPosition(position), null, 'Impression-weighted average position from weekly query rows'),
            cell('vs-prior', 'vs prior', vs?.text ?? '—', vs?.tone ?? null, 'Clicks versus the prior 28 days'),
        ],
        points: bingSeries(currentDays, input.window.current),
        queries: queryTable.rows,
        pages: pageTable.rows,
        hiddenQueries: queryTable.hidden,
        hiddenPages: pageTable.hidden,
        queriesNote: queryTable.rows.length === 0
            ? (queryIncomplete ? 'Query list may be incomplete' : 'No queries with clicks in this range')
            : (queryIncomplete ? 'Query list may be incomplete' : null),
        pagesNote: pageTable.rows.length === 0
            ? (pagesIncomplete ? 'Pages were not stored for this range' : 'No pages with clicks in this range')
            : (pagesIncomplete ? 'Page list may be incomplete' : null),
    };
}
