import { dateOffset } from '@/lib/gsc/history';
import { eachDate } from '@/lib/search-reporting/range';
import { proofHost } from '@/lib/search-reporting/proof';
import { normalizeResultUrl } from '@/lib/search-reporting/result-url';

import { controlDayValue, controlFor, controlModeLabel } from './control';
import { dayKpi, isGaKpi, moveFor, sumWindow } from './metrics';
import {
    CAUSATION,
    CHECKPOINTS,
    GSC_LAG_DAYS,
    VERDICT_THRESHOLDS,
    type CheckpointDays,
} from './thresholds';
import { afterWindow, baselineWindow, finalThrough, formatDay, shiftWindowLastYear } from './time';
import {
    VERDICT_LABEL,
    type ChartPoint,
    type CheckpointRead,
    type Confounder,
    type DayPoint,
    type ImpactModel,
    type Kpi,
    type MetricRead,
    type QueryCompare,
    type SeoChange,
    type TimelineItem,
    type Verdict,
} from './types';
import { COMPARISON_UNAVAILABLE_LABEL, headlineFields, nextCheck } from './list';
import { testProgress } from './progress';
import { classifyCheckpoint, isLowData } from './verdict';

export interface ImpactSource {
    liveOn: string;
    kpi: Kpi;
    now: Date;
    compareLastYear: boolean;
    gscConnected: boolean;
    ga4Connected: boolean;
    pageDays: readonly DayPoint[];
    gscPageDays?: readonly DayPoint[];
    sitewideDays: readonly DayPoint[];
    restPositionDays?: readonly DayPoint[];
    pickedControlDays?: readonly DayPoint[];
    pickedGa4Days?: readonly DayPoint[];
    yoyPageDays?: readonly DayPoint[];
    yoySitewideDays?: readonly DayPoint[];
    queries?: readonly { query: string; days: readonly DayPoint[] }[];
}

export function buildImpact(source: ImpactSource): ImpactModel {
    const through = finalThrough(source.now);
    const lagNote = `Google Search Console is about ${GSC_LAG_DAYS} days behind (final through ${formatDay(through)}).`;
    const baselineSpan = baselineWindow(source.liveOn);
    const baseline = sumWindow(source.pageDays, baselineSpan.start, baselineSpan.end, through);
    const baselineReady = baseline.measured && baseline.daysPresent >= VERDICT_THRESHOLDS.minBaselineDays;
    const gscBaseline = source.kpi === 'clicks' && source.gscConnected && through >= baselineSpan.end
        ? sumWindow(source.gscPageDays ?? source.pageDays, baselineSpan.start, baselineSpan.end, through)
        : null;
    const lowClickBaseline = gscBaseline && gscBaseline.daysPresent >= VERDICT_THRESHOLDS.minBaselineDays
        && gscBaseline.clicks < VERDICT_THRESHOLDS.lowDataClicks
        ? gscBaseline.clicks
        : null;
    const kpi = lowClickBaseline == null ? source.kpi : 'impressions';
    const scored = { ...source, kpi };
    const connected = isGaKpi(kpi) ? source.ga4Connected : source.gscConnected;
    const before = readControls(scored, baseline, baselineSpan, through);

    const checkpoints = CHECKPOINTS.map(days => readCheckpoint({
        days,
        source: scored,
        through,
        lagNote,
        baseline,
        baselineReady,
        baselineControl: before.control,
        connected,
    }));
    const ready = checkpoints.filter(item => item.ready);
    const headline = ready.length > 0
        ? ready[ready.length - 1]
        : checkpoints[0];

    const yoy = source.compareLastYear
        ? readYoy(source, through)
        : null;

    const windowEnd = afterWindow(source.liveOn, 56).end;
    const lagEnd = dateOffset(through, GSC_LAG_DAYS);
    const seriesEnd = windowEnd < lagEnd ? windowEnd : lagEnd;
    const series = chartSeries(scored, through, baselineSpan.start, seriesEnd < baselineSpan.start ? baselineSpan.start : seriesEnd);

    return {
        kpi,
        lowClickBaseline,
        liveOn: source.liveOn,
        finalThrough: through,
        lagDays: GSC_LAG_DAYS,
        baseline,
        baselineControl: before.pickedClicks ?? before.restOfSite,
        baselineSite: before.site,
        baselineReady,
        yoy: yoy?.read ?? null,
        yoyNote: source.compareLastYear
            ? (yoy?.note ?? 'Last year is context. The result uses the 28 days before the change.')
            : null,
        headline,
        checkpoints,
        series,
        queries: queryRows(source, through, headline),
        pageRows: [],
        gscConnected: source.gscConnected,
        ga4Connected: source.ga4Connected,
        causation: CAUSATION,
        controlLabel: source.pickedControlDays ? controlModeLabel('picked')
            : controlModeLabel(before.site || before.control.read ? 'untouched' : 'none'),
        sources: sourceLines(source),
    };
}

function readControls(source: ImpactSource, page: MetricRead, span: { start: string; end: string }, through: string) {
    const sum = (days: readonly DayPoint[]) => sumWindow(days, span.start, span.end, through);
    const siteRead = sum(source.sitewideDays);
    const site = siteRead.measured ? siteRead : null;
    const restPosition = source.restPositionDays && sum(source.restPositionDays);
    const pickedClicks = source.pickedControlDays && sum(source.pickedControlDays);
    const picked = pickedClicks && (isGaKpi(source.kpi) ? sum(source.pickedGa4Days ?? []) : pickedClicks);
    const rest = controlFor(page, site, 'clicks', restPosition);
    return {
        control: controlFor(page, site, source.kpi, restPosition, picked),
        site,
        restOfSite: rest.mode === 'untouched' ? rest.read : null,
        pickedClicks,
    };
}

function readCheckpoint(input: {
    days: CheckpointDays;
    source: ImpactSource;
    through: string;
    lagNote: string;
    baseline: ReturnType<typeof sumWindow>;
    baselineReady: boolean;
    baselineControl: ReturnType<typeof controlFor>;
    connected: boolean;
}): CheckpointRead {
    const span = afterWindow(input.source.liveOn, input.days);
    const page = sumWindow(input.source.pageDays, span.start, span.end, input.through);
    const covered = page.daysExpected > 0 && page.daysPresent / page.daysExpected >= VERDICT_THRESHOLDS.minAfterCoverage;
    const finished = span.end <= input.through && covered;
    const partial = page.measured && page.daysPresent < page.daysExpected;
    const baselinePartial = input.baseline.measured && input.baseline.daysPresent < input.baseline.daysExpected;
    const { control, site, restOfSite, pickedClicks } = readControls(input.source, page, span, input.through);
    const baselineControl = input.baselineControl;
    const pageMove = moveFor(input.source.kpi, input.baseline, page);
    const controlMove = control.mode === baselineControl.mode && control.read && baselineControl.read
        ? moveFor(input.source.kpi, baselineControl.read, control.read)
        : null;
    const controlUnreliable = control.unreliable || baselineControl.unreliable;
    const lowData = isLowData(input.source.kpi, input.baseline, page);
    const classified = classifyCheckpoint({
        kpi: input.source.kpi,
        ready: finished,
        baselineReady: input.baselineReady,
        connected: input.connected,
        partial: partial || baselinePartial,
        lowData,
        page: pageMove,
        control: controlMove,
        controlMode: control.mode,
        controlUnreliable,
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
        controlUnreliable,
        pageMove,
        controlMove,
        lift: classified.lift,
        restOfSite,
        pickedControlClicks: pickedClicks,
        sitewide: site,
    };
}

function readYoy(source: ImpactSource, through: string): { read: ReturnType<typeof sumWindow>; note: string } {
    const span = shiftWindowLastYear(baselineWindow(source.liveOn));
    const read = sumWindow(source.yoyPageDays ?? [], span.start, span.end, through);
    if (!read.measured || read.daysPresent < VERDICT_THRESHOLDS.minBaselineDays) {
        return { read, note: `Same dates last year (${formatDay(span.start)}–${formatDay(span.end)}) are not stored. The result still uses the 28 days before the change.` };
    }
    return { read, note: 'Last year is context. The result uses the 28 days before the change.' };
}

function pageCounts(day: DayPoint | undefined, preliminary: boolean) {
    if (preliminary || !day || day.preliminary) {
        return { clicks: null, impressions: null, ctr: null, position: null };
    }
    return {
        clicks: day.clicks,
        impressions: day.impressions,
        ctr: day.impressions > 0 ? day.clicks / day.impressions : null,
        position: day.impressions > 0 ? day.position : null,
    };
}

function chartSeries(source: ImpactSource, through: string, start: string, end: string): ChartPoint[] {
    const pageByDate = new Map(source.pageDays.map(day => [day.date, day]));
    const siteByDate = new Map(source.sitewideDays.map(day => [day.date, day]));
    const restByDate = new Map(source.restPositionDays?.map(day => [day.date, day]));
    const pickedByDate = new Map(source.pickedControlDays?.map(day => [day.date, day]));
    const pickedGa4ByDate = new Map(source.pickedGa4Days?.map(day => [day.date, day]));
    const points: ChartPoint[] = [];
    const last = end < start ? start : end;
    for (const date of eachDate(start, last)) {
        const preliminary = date > through;
        const pageDay = date === source.liveOn ? undefined : pageByDate.get(date);
        const siteDay = date === source.liveOn ? undefined : siteByDate.get(date);
        const measuredPage = !preliminary && pageDay && !pageDay.preliminary ? pageDay : undefined;
        const controlValue = (kpi: Kpi) => {
            if (preliminary || date === source.liveOn) return null;
            if (!source.pickedControlDays) return controlDayValue(pageDay, siteDay, kpi, restByDate.get(date));
            const picked = (isGaKpi(kpi) ? pickedGa4ByDate : pickedByDate).get(date);
            return picked && !picked.preliminary ? dayKpi(picked, kpi) : null;
        };
        points.push({
            date,
            page: measuredPage ? dayKpi(measuredPage, source.kpi) : null,
            control: controlValue(source.kpi),
            live: date === source.liveOn,
            preliminary,
            ...pageCounts(pageDay, preliminary),
            controlClicks: controlValue('clicks'),
            controlImpressions: controlValue('impressions'),
            controlCtr: controlValue('ctr'),
            controlPosition: controlValue('avg_position'),
        });
    }
    if (!points.some(point => point.date === source.liveOn)) {
        points.push({
            date: source.liveOn,
            page: null,
            control: null,
            live: true,
            preliminary: source.liveOn > through,
            clicks: null,
            impressions: null,
            ctr: null,
            position: null,
            controlClicks: null,
            controlImpressions: null,
            controlCtr: null,
            controlPosition: null,
        });
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
        const beforeClicks = prior.measured ? prior.clicks : null;
        const afterClicks = next.measured ? next.clicks : null;
        const beforeImpressions = prior.measured ? prior.impressions : null;
        const afterImpressions = next.measured ? next.impressions : null;
        return {
            query: query.query,
            beforeClicks,
            afterClicks,
            beforeImpressions,
            afterImpressions,
            beforePosition: prior.measured ? prior.position : null,
            afterPosition: next.measured ? next.position : null,
            beforeCtr: prior.measured ? prior.ctr : null,
            afterCtr: next.measured ? next.ctr : null,
            clicksDelta: beforeClicks != null && afterClicks != null ? afterClicks - beforeClicks : null,
            impressionsDelta: beforeImpressions != null && afterImpressions != null ? afterImpressions - beforeImpressions : null,
            positionDelta: prior.measured && next.measured && prior.position != null && next.position != null
                ? next.position - prior.position
                : null,
        };
    });
}

function sourceLines(source: ImpactSource): string[] {
    const search = source.gscConnected
        ? 'Google Search Console · organic search'
        : "Google Search Console isn't connected";
    const analytics = source.ga4Connected ? 'Analytics · landing page' : 'Analytics not connected';
    return [search, analytics];
}

export function dailyRateText(kpi: Kpi, before: MetricRead, after: MetricRead): string {
    const prior = daily(kpi, before);
    const next = daily(kpi, after);
    if (prior == null || next == null) return 'Not ready yet';
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
    const comparisonUnavailable = impact.kpi === 'avg_position' && impact.gscConnected && (
        head.ready ? head.controlMove?.helpful == null : !impact.series.some(point => point.controlPosition != null)
    );
    const page = change.pages[0];
    const headline = headlineFields(head);
    const upcoming = nextCheck(change.liveOn, impact.finalThrough);
    const progress = testProgress(change.liveOn, impact.finalThrough);
    return {
        id: change.id,
        title: change.title,
        changeType: change.changeType,
        liveAt: change.liveAt,
        liveOn: change.liveOn,
        pageLabel: page?.label || page?.url || 'Page',
        url: page?.url ?? '',
        verdict: comparisonUnavailable ? null : head.verdict,
        estimate: !comparisonUnavailable && head.estimate,
        deltaText: comparisonUnavailable ? COMPARISON_UNAVAILABLE_LABEL
            : head.verdict === 'too_early' ? VERDICT_LABEL.too_early
                : dailyRateText(impact.kpi, impact.baseline, head.page),
        kpi: impact.kpi,
        checkpointDays: head.ready ? head.days : null,
        headlineDays: headline.headlineDays,
        headlinePct: headline.headlinePct,
        nextCheckOn: upcoming.nextCheckOn,
        nextCheckDays: upcoming.nextCheckDays,
        pageCount: change.pages.length,
        progressPercent: progress?.percent ?? null,
        progressStatus: progress?.status ?? null,
        progressDays: progress?.targetDays ?? null,
    };
}

export function findConfounders(
    changes: readonly SeoChange[],
    focus: SeoChange,
): Confounder[] {
    const before = baselineWindow(focus.liveOn);
    const after = afterWindow(focus.liveOn, 56);
    const testSites = new Set(focus.pages.map(page => proofHost(page.url)).filter(Boolean));
    const testKeys = new Set(focus.pages.map(page => normalizeResultUrl(page.url)).filter(Boolean));
    const controlKeys = new Set(focus.controlUrls?.map(normalizeResultUrl).filter(Boolean));
    const rows: Confounder[] = [];
    for (const change of changes) {
        if (change.id === focus.id || change.clientId !== focus.clientId) continue;
        if (change.liveOn < before.start || change.liveOn > after.end) continue;
        const sameSitePages = change.pages.filter(page => testSites.has(proofHost(page.url)));
        if (sameSitePages.length === 0) continue;
        const keys = sameSitePages.map(page => normalizeResultUrl(page.url));
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
            touchesTestPage: keys.some(key => testKeys.has(key)),
            touchesControlPage: keys.some(key => controlKeys.size > 0 ? controlKeys.has(key) : !testKeys.has(key)),
        });
    }
    rows.sort((a, b) => a.liveOn.localeCompare(b.liveOn) || a.title.localeCompare(b.title));
    return rows;
}

export function overlapLabel(overlap: Confounder['overlap']): string {
    if (overlap === 'same_day') return 'Same day';
    if (overlap === 'baseline') return 'Baseline window';
    return 'After window';
}

export function verdictRank(verdict: Verdict): number {
    if (verdict === 'declined') return 0;
    if (verdict === 'too_early') return 1;
    if (verdict === 'flat') return 2;
    return 3;
}
