import { eachDate } from '@/lib/search-reporting/range';

import { controlDayValue, controlFor } from './control';
import { dayKpi, isGaKpi, moveFor, sumWindow } from './metrics';
import {
    CAUSATION,
    CHECKPOINTS,
    GSC_LAG_DAYS,
    VERDICT_THRESHOLDS,
    type CheckpointDays,
} from './thresholds';
import { afterWindow, baselineWindow, finalThrough, formatDay, shiftWindowLastYear } from './time';
import type {
    ChartPoint,
    CheckpointRead,
    Confounder,
    DayPoint,
    ImpactModel,
    Kpi,
    MetricRead,
    QueryCompare,
    SeoChange,
    TimelineItem,
    Verdict,
} from './types';
import { classifyCheckpoint, isLowData } from './verdict';

export interface ImpactSource {
    liveOn: string;
    kpi: Kpi;
    now: Date;
    compareLastYear: boolean;
    gscConnected: boolean;
    ga4Connected: boolean;
    pageDays: readonly DayPoint[];
    sitewideDays: readonly DayPoint[];
    yoyPageDays?: readonly DayPoint[];
    yoySitewideDays?: readonly DayPoint[];
    queries?: readonly { query: string; days: readonly DayPoint[] }[];
}

export function buildImpact(source: ImpactSource): ImpactModel {
    const through = finalThrough(source.now);
    const lagNote = `Search Console is about ${GSC_LAG_DAYS} days behind (final through ${formatDay(through)}).`;
    const baselineSpan = baselineWindow(source.liveOn);
    const baseline = sumWindow(source.pageDays, baselineSpan.start, baselineSpan.end, through);
    const baselineReady = baseline.measured && baseline.daysPresent >= VERDICT_THRESHOLDS.minBaselineDays;
    const connected = isGaKpi(source.kpi) ? source.ga4Connected : source.gscConnected;
    const siteBaseline = sumWindow(source.sitewideDays, baselineSpan.start, baselineSpan.end, through);

    const checkpoints = CHECKPOINTS.map(days => readCheckpoint({
        days,
        source,
        through,
        lagNote,
        baseline,
        baselineReady,
        siteBaseline,
        connected,
    }));
    const ready = checkpoints.filter(item => item.ready);
    const headline = ready.length > 0
        ? ready[ready.length - 1]
        : checkpoints[0];

    const yoy = source.compareLastYear
        ? readYoy(source, through)
        : null;

    const control = controlFor(baseline, siteBaseline.measured ? siteBaseline : null, source.kpi);
    const seriesEnd = afterWindow(source.liveOn, 56).end;
    const series = chartSeries(source, through, baselineSpan.start, seriesEnd > through ? through : seriesEnd);

    return {
        kpi: source.kpi,
        liveOn: source.liveOn,
        finalThrough: through,
        lagDays: GSC_LAG_DAYS,
        baseline,
        baselineReady,
        yoy: yoy?.read ?? null,
        yoyNote: source.compareLastYear
            ? (yoy?.note ?? 'Last year is context. The verdict uses the 28 days before the change.')
            : null,
        headline,
        checkpoints,
        series,
        queries: queryRows(source, through, headline),
        gscConnected: source.gscConnected,
        ga4Connected: source.ga4Connected,
        causation: CAUSATION,
        controlLabel: control.label,
        sources: sourceLines(source),
    };
}

function readCheckpoint(input: {
    days: CheckpointDays;
    source: ImpactSource;
    through: string;
    lagNote: string;
    baseline: ReturnType<typeof sumWindow>;
    baselineReady: boolean;
    siteBaseline: ReturnType<typeof sumWindow>;
    connected: boolean;
}): CheckpointRead {
    const span = afterWindow(input.source.liveOn, input.days);
    const page = sumWindow(input.source.pageDays, span.start, span.end, input.through);
    const site = sumWindow(input.source.sitewideDays, span.start, span.end, input.through);
    const covered = page.daysExpected > 0 && page.daysPresent / page.daysExpected >= VERDICT_THRESHOLDS.minAfterCoverage;
    const finished = span.end <= input.through && covered;
    const partial = page.measured && page.daysPresent < page.daysExpected;
    const baselinePartial = input.baseline.measured && input.baseline.daysPresent < input.baseline.daysExpected;
    const control = controlFor(page, site.measured ? site : null, input.source.kpi);
    const baselineControl = controlFor(
        input.baseline,
        input.siteBaseline.measured ? input.siteBaseline : null,
        input.source.kpi,
    );
    const pageMove = moveFor(input.source.kpi, input.baseline, page);
    const controlMove = control.read && baselineControl.read
        ? moveFor(input.source.kpi, baselineControl.read, control.read)
        : null;
    const lowData = isLowData(input.source.kpi, input.baseline, page);
    const classified = classifyCheckpoint({
        kpi: input.source.kpi,
        ready: finished,
        baselineReady: input.baselineReady,
        connected: input.connected,
        partial: partial || baselinePartial || control.unreliable,
        lowData,
        page: pageMove,
        control: controlMove,
        controlMode: control.mode,
        controlUnreliable: control.unreliable,
        lagNote: input.lagNote,
    });
    return {
        days: input.days,
        ready: finished,
        estimate: classified.estimate,
        lowData: classified.lowData,
        verdict: classified.verdict,
        note: classified.note,
        page,
        control: control.read,
        controlMode: control.mode,
        controlUnreliable: control.unreliable,
        pageMove,
        controlMove,
        lift: classified.lift,
    };
}

function readYoy(source: ImpactSource, through: string): { read: ReturnType<typeof sumWindow>; note: string } {
    const span = shiftWindowLastYear(baselineWindow(source.liveOn));
    const read = sumWindow(source.yoyPageDays ?? [], span.start, span.end, through);
    if (!read.measured || read.daysPresent < VERDICT_THRESHOLDS.minBaselineDays) {
        return { read, note: `Same dates last year (${formatDay(span.start)}–${formatDay(span.end)}) are not stored. The verdict still uses the 28 days before the change.` };
    }
    return { read, note: 'Last year is context. The verdict uses the 28 days before the change.' };
}

function chartSeries(source: ImpactSource, through: string, start: string, end: string): ChartPoint[] {
    const pageByDate = new Map(source.pageDays.map(day => [day.date, day]));
    const siteByDate = new Map(source.sitewideDays.map(day => [day.date, day]));
    const points: ChartPoint[] = [];
    const last = end < start ? start : end;
    for (const date of eachDate(start, last)) {
        const preliminary = date > through;
        const pageDay = pageByDate.get(date);
        const siteDay = siteByDate.get(date);
        points.push({
            date,
            page: preliminary || !pageDay || pageDay.preliminary ? null : dayKpi(pageDay, source.kpi),
            control: preliminary ? null : controlDayValue(pageDay, siteDay, source.kpi),
            live: date === source.liveOn,
            preliminary,
        });
    }
    if (!points.some(point => point.date === source.liveOn)) {
        points.push({ date: source.liveOn, page: null, control: null, live: true, preliminary: source.liveOn > through });
    }
    return points;
}

function queryRows(source: ImpactSource, through: string, headline: CheckpointRead): QueryCompare[] {
    const before = baselineWindow(source.liveOn);
    const after = headline.ready
        ? afterWindow(source.liveOn, headline.days)
        : afterWindow(source.liveOn, 28);
    return (source.queries ?? []).map(query => {
        const prior = sumWindow(query.days, before.start, before.end, through);
        const next = sumWindow(query.days, after.start, after.end, through);
        return {
            query: query.query,
            beforeClicks: prior.measured ? prior.clicks : 0,
            afterClicks: next.measured ? next.clicks : 0,
            beforeImpressions: prior.measured ? prior.impressions : 0,
            afterImpressions: next.measured ? next.impressions : 0,
            beforePosition: prior.position,
            afterPosition: next.position,
            beforeCtr: prior.ctr,
            afterCtr: next.ctr,
            clicksDelta: (next.measured ? next.clicks : 0) - (prior.measured ? prior.clicks : 0),
            impressionsDelta: (next.measured ? next.impressions : 0) - (prior.measured ? prior.impressions : 0),
            positionDelta: prior.position != null && next.position != null ? next.position - prior.position : null,
        };
    });
}

function sourceLines(source: ImpactSource): string[] {
    const lines = [
        source.gscConnected ? 'Search Console · organic' : 'Search Console not connected',
        source.ga4Connected ? 'Analytics · landing page' : 'Analytics not connected',
    ];
    return lines;
}

export function dailyRateText(kpi: Kpi, before: MetricRead, after: MetricRead): string {
    const prior = daily(kpi, before);
    const next = daily(kpi, after);
    if (prior == null || next == null) return 'Too early';
    const move = moveFor(kpi, before, after);
    const rel = formatHelpful(move.helpful, move.fromZero);
    if (kpi === 'avg_position') return `${formatPosition(prior)} → ${formatPosition(next)} ${rel}`.trim();
    if (kpi === 'ctr') return `${formatCtr(prior)} → ${formatCtr(next)} ${rel}`.trim();
    return `${formatDaily(prior)}/day → ${formatDaily(next)}/day ${rel}`.trim();
}

function daily(kpi: Kpi, read: MetricRead): number | null {
    if (!read.measured || read.daysPresent <= 0) return null;
    if (kpi === 'clicks') return read.clicks / read.daysPresent;
    if (kpi === 'impressions') return read.impressions / read.daysPresent;
    if (kpi === 'organic_sessions') return read.organicSessions == null ? null : read.organicSessions / read.daysPresent;
    if (kpi === 'key_events') return read.keyEvents == null ? null : read.keyEvents / read.daysPresent;
    if (kpi === 'ctr') return read.ctr;
    return read.position;
}

export function formatHelpful(helpful: number | null, fromZero: boolean): string {
    if (fromZero) return '(up from 0)';
    if (helpful == null) return '';
    const pct = Math.round(helpful * 1000) / 10;
    const body = Number.isInteger(pct) ? String(Math.abs(pct)) : Math.abs(pct).toFixed(1);
    if (pct === 0) return '(0%)';
    return pct > 0 ? `(+${body}%)` : `(−${body}%)`;
}

function formatDaily(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded)
        ? new Intl.NumberFormat('en-US').format(rounded)
        : rounded.toFixed(1);
}

function formatPosition(value: number): string {
    return value.toFixed(1);
}

function formatCtr(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
}

export function timelineItem(change: SeoChange, impact: ImpactModel): TimelineItem {
    const head = impact.headline;
    const page = change.pages[0];
    return {
        id: change.id,
        title: change.title,
        changeType: change.changeType,
        liveAt: change.liveAt,
        liveOn: change.liveOn,
        pageLabel: page?.label || page?.url || 'Page',
        url: page?.url ?? '',
        verdict: head.verdict,
        estimate: head.estimate,
        deltaText: head.verdict === 'too_early' ? 'Too early' : dailyRateText(change.kpi, impact.baseline, head.page),
        kpi: change.kpi,
        checkpointDays: head.ready ? head.days : null,
    };
}

export function findConfounders(
    changes: readonly Pick<SeoChange, 'id' | 'title' | 'changeType' | 'liveAt' | 'liveOn'>[],
    focus: Pick<SeoChange, 'id' | 'liveOn'>,
    checkpointDays: CheckpointDays = 28,
): Confounder[] {
    const before = baselineWindow(focus.liveOn);
    const after = afterWindow(focus.liveOn, checkpointDays);
    const rows: Confounder[] = [];
    for (const change of changes) {
        if (change.id === focus.id) continue;
        if (change.liveOn < before.start || change.liveOn > after.end) continue;
        const overlap = change.liveOn === focus.liveOn
            ? 'same_day'
            : change.liveOn < focus.liveOn
                ? 'baseline'
                : 'after';
        rows.push({
            id: change.id,
            title: change.title,
            changeType: change.changeType,
            liveAt: change.liveAt,
            liveOn: change.liveOn,
            overlap,
        });
    }
    rows.sort((a, b) => a.liveOn.localeCompare(b.liveOn) || a.title.localeCompare(b.title));
    return rows;
}

export function overlapLabel(overlap: Confounder['overlap']): string {
    if (overlap === 'same_day') return 'Same day';
    if (overlap === 'baseline') return 'In the baseline';
    return 'In the after window';
}

export function verdictRank(verdict: Verdict): number {
    if (verdict === 'declined') return 0;
    if (verdict === 'too_early') return 1;
    if (verdict === 'flat') return 2;
    return 3;
}
