/**
 * Page or URL results for Campaign.
 *
 * Each distinct stored `campaign_initiatives.page_url` is its own row. The
 * same URL on more than one initiative stays one row and keeps every title,
 * so a stored URL is not dropped. The next milestone's URL is first when that
 * initiative has one. The rest follow roadmap order.
 *
 * Windows are the Search dashboard pair (`pairedWindows`, `coverWindow`,
 * complete days only). The total is `periodMetrics`. `propertySeries` is the
 * wrong helper for one page: a property day with no row is missing, while a
 * complete uncapped page-grain day with no row for this URL is a stored zero.
 * A capped day (`pageLimited`) with no row for the URL stays unmeasured.
 * Rows tagged `utm_medium=gbp` stay on their own surface. They are not added
 * to the organic page, the sitewide total, or Business Profile calls.
 *
 * Search reporting's ship-date URL ledger is a different window, so it is not
 * reused. The history loader's page grain is the same read the history route
 * already serves.
 */

import { classifySurface } from '@/lib/gsc/history';
import type { HistoryDay, HistoryRow } from '@/lib/gsc/insights';
import { formatDelta } from '@/lib/reporting/delta';
import { formatCount, formatSpan, pairedWindows, periodMetrics, type ChartPoint } from '@/lib/search-dashboard/model';
import { coverWindow, eachDate } from '@/lib/search-reporting/range';
import { gscPageKey } from '@/lib/search-reporting/proof';
import { nextMilestone, orderedInitiatives, type CampaignInitiative } from './initiatives';
import type { CampaignPageSeries, MeasurementReason } from './sources';

export interface CampaignPageResult {
    key: string;
    surface: 'organic' | 'gbp_link';
    url: string;
    titles: string[];
    initiativeIds: string[];
    status: 'measurable' | 'not_measurable';
    reason: MeasurementReason;
    clicks: number | null;
    clicksLabel: string;
    priorClicks: number | null;
    deltaLabel: string | null;
    currentLabel: string | null;
    priorLabel: string | null;
    asOf: string | null;
    comparisonLabel: string;
    baselineCaption: string | null;
}

interface PageTarget {
    key: string;
    surface: 'organic' | 'gbp_link';
    url: string;
    titles: string[];
    initiativeIds: string[];
    matchable: boolean;
}

interface IndexedRow {
    key: string;
    surface: 'organic' | 'gbp_link';
    clicks: number | null;
    impressions: number;
}

function finiteNonNegative(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return value;
}

function baselineDelta(current: number, prior: number): string | null {
    const delta = formatDelta(current, prior, { metric: 'count', audience: 'staff', presentation: 'reporting' });
    if (delta.kind !== 'change' && delta.kind !== 'noise') return null;
    if (delta.percent != null && delta.direction) {
        const arrow = delta.direction === 'up' ? '↑' : '↓';
        return `${arrow} ${Math.abs(delta.percent).toFixed(0)}% vs baseline`;
    }
    return `${delta.text} vs baseline`;
}

function emptyResult(target: PageTarget, reason: Exclude<MeasurementReason, 'measured'>): CampaignPageResult {
    return {
        key: target.key,
        surface: target.surface,
        url: target.url,
        titles: target.titles,
        initiativeIds: target.initiativeIds,
        status: 'not_measurable',
        reason,
        clicks: null,
        clicksLabel: '—',
        priorClicks: null,
        deltaLabel: null,
        currentLabel: null,
        priorLabel: null,
        asOf: null,
        comparisonLabel: 'Not yet measurable',
        baselineCaption: null,
    };
}

/** Stored page URLs, milestone first, with shared URLs collapsed to one row. */
export function pageResultTargets(initiatives: readonly CampaignInitiative[], today: string): PageTarget[] {
    const milestoneId = nextMilestone(initiatives, today)?.initiativeId ?? null;
    const ordered = orderedInitiatives(initiatives);
    const rank = new Map(ordered.map((item, index) => [item.id, index]));
    const groups = new Map<string, PageTarget>();
    for (const initiative of ordered) {
        const url = initiative.pageUrl?.trim() ?? '';
        if (!url) continue;
        const key = gscPageKey(url);
        const surface = classifySurface(url) === 'gbp_link' ? 'gbp_link' : 'organic';
        const groupId = key ? `${surface}\u0000${key}` : `unkeyed\u0000${initiative.id}`;
        const existing = groups.get(groupId);
        if (existing) {
            existing.titles.push(initiative.title);
            existing.initiativeIds.push(initiative.id);
            if (initiative.id === milestoneId) existing.url = url;
            continue;
        }
        groups.set(groupId, {
            key: key ?? initiative.id,
            surface,
            url,
            titles: [initiative.title],
            initiativeIds: [initiative.id],
            matchable: key != null,
        });
    }
    for (const group of groups.values()) {
        if (!milestoneId) continue;
        const index = group.initiativeIds.indexOf(milestoneId);
        if (index <= 0) continue;
        group.initiativeIds.unshift(group.initiativeIds.splice(index, 1)[0]);
        group.titles.unshift(group.titles.splice(index, 1)[0]);
    }
    return [...groups.values()].sort((a, b) => {
        const aMilestone = milestoneId != null && a.initiativeIds.includes(milestoneId);
        const bMilestone = milestoneId != null && b.initiativeIds.includes(milestoneId);
        if (aMilestone !== bMilestone) return aMilestone ? -1 : 1;
        const aRank = Math.min(...a.initiativeIds.map(id => rank.get(id) ?? Number.MAX_SAFE_INTEGER));
        const bRank = Math.min(...b.initiativeIds.map(id => rank.get(id) ?? Number.MAX_SAFE_INTEGER));
        return aRank - bRank || a.url.localeCompare(b.url);
    });
}

function indexPageRows(rows: readonly HistoryRow[]): Map<string, IndexedRow[]> {
    const map = new Map<string, IndexedRow[]>();
    for (const row of rows) {
        if (!row.page) continue;
        const key = gscPageKey(row.page);
        if (!key) continue;
        const clicks = finiteNonNegative(row.clicks);
        const impressions = finiteNonNegative(row.impressions);
        const indexed: IndexedRow = {
            key,
            surface: classifySurface(row.page) === 'gbp_link' ? 'gbp_link' : 'organic',
            clicks: clicks == null || impressions == null ? null : clicks,
            impressions: impressions ?? 0,
        };
        const list = map.get(row.dayId);
        if (list) list.push(indexed);
        else map.set(row.dayId, [indexed]);
    }
    return map;
}

function daysByDate(days: readonly HistoryDay[]): Map<string, HistoryDay> {
    const map = new Map<string, HistoryDay>();
    for (const day of days) {
        const current = map.get(day.date);
        if (!current || (current.isIncomplete && !day.isIncomplete)) map.set(day.date, day);
    }
    return map;
}

function windowPoints(
    days: Map<string, HistoryDay>,
    rows: Map<string, IndexedRow[]>,
    span: { start: string; end: string },
    target: PageTarget,
): ChartPoint[] | null {
    const points: ChartPoint[] = [];
    for (const date of eachDate(span.start, span.end)) {
        const day = days.get(date);
        if (!day || day.isIncomplete) return null;
        const matches = (rows.get(day.id) ?? []).filter(row => row.key === target.key && row.surface === target.surface);
        if (matches.some(row => row.clicks == null)) return null;
        if (matches.length === 0) {
            if (day.pageLimited) return null;
            points.push({ date, clicks: 0, impressions: 0 });
            continue;
        }
        let clicks = 0;
        let impressions = 0;
        for (const row of matches) {
            clicks += row.clicks ?? 0;
            impressions += row.impressions;
        }
        points.push({ date, clicks, impressions });
    }
    return points;
}

function measureTarget(
    target: PageTarget,
    series: CampaignPageSeries,
    today: string,
    days: Map<string, HistoryDay>,
    rows: Map<string, IndexedRow[]>,
): CampaignPageResult {
    if (!target.matchable) return emptyResult(target, 'unavailable');
    if (series.status === 'unavailable') return emptyResult(target, 'unavailable');
    if (series.status === 'incomplete') return emptyResult(target, 'incomplete');
    if (series.status === 'missing') return emptyResult(target, 'missing');

    const flags = [...days.values()].map(day => ({ date: day.date, isIncomplete: Boolean(day.isIncomplete) }));
    const window = pairedWindows(flags, today);
    if (!window) return emptyResult(target, 'missing');
    const coverage = coverWindow(window.current, flags);
    if (!coverage.final) return emptyResult(target, 'incomplete');
    const currentPoints = windowPoints(days, rows, window.current, target);
    const current = currentPoints ? periodMetrics(currentPoints) : null;
    if (!currentPoints || currentPoints.length !== coverage.daysExpected || current?.clicks == null) {
        return emptyResult(target, 'incomplete');
    }

    const priorCoverage = coverWindow(window.prior, flags);
    const priorPoints = window.comparable && priorCoverage.final
        ? windowPoints(days, rows, window.prior, target)
        : null;
    const prior = priorPoints && priorPoints.length === priorCoverage.daysExpected ? periodMetrics(priorPoints) : null;
    const priorClicks = prior?.clicks ?? null;
    const priorLabel = priorClicks == null ? null : formatSpan(window.prior.start, window.prior.end);
    const currentLabel = formatSpan(window.current.start, window.current.end);
    const deltaLabel = priorClicks == null ? null : baselineDelta(current.clicks, priorClicks);
    return {
        key: target.key,
        surface: target.surface,
        url: target.url,
        titles: target.titles,
        initiativeIds: target.initiativeIds,
        status: 'measurable',
        reason: 'measured',
        clicks: current.clicks,
        clicksLabel: formatCount(current.clicks),
        priorClicks,
        deltaLabel,
        currentLabel,
        priorLabel,
        asOf: window.current.end,
        comparisonLabel: deltaLabel ?? (priorClicks == null ? 'No baseline' : 'No comparable baseline'),
        baselineCaption: priorClicks == null || priorLabel == null
            ? null
            : `Baseline ${formatCount(priorClicks)} · ${priorLabel}.`,
    };
}

export function campaignPageResults(input: {
    series: CampaignPageSeries;
    initiatives: readonly CampaignInitiative[];
    today: string;
}): CampaignPageResult[] {
    const targets = pageResultTargets(input.initiatives, input.today);
    if (targets.length === 0) return [];
    const days = input.series.status === 'ready' ? daysByDate(input.series.days) : new Map<string, HistoryDay>();
    const rows = input.series.status === 'ready' ? indexPageRows(input.series.rows) : new Map<string, IndexedRow[]>();
    return targets.map(target => measureTarget(target, input.series, input.today, days, rows));
}

export function assemblePageSeries(input: {
    connected: boolean;
    failed: boolean;
    truncated: boolean;
    days: readonly HistoryDay[];
    rows: readonly HistoryRow[];
}): CampaignPageSeries {
    if (!input.connected || input.failed) return { status: 'unavailable', days: [], rows: [] };
    if (input.truncated) return { status: 'incomplete', days: [], rows: [] };
    if (input.days.length === 0) return { status: 'missing', days: [], rows: [] };
    return { status: 'ready', days: [...input.days], rows: [...input.rows] };
}
