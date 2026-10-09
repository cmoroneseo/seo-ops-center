/**
 * Staff Search Insights v2 view model.
 * Deltas, freshness, and receipt rows stay in `lib/reporting`. This module
 * only decides what the tab shows: states-matrix copy, chart geometry, and
 * how many receipt triggers the default view mounts.
 */

import { dateOffset } from '@/lib/gsc/history';
import { STATES_COPY } from '@/lib/reporting/states-copy';
import { deltaColumnHeader, type FormattedDelta } from '@/lib/reporting/delta';
import type { ReceiptInput } from '@/lib/reporting/receipt';
import { inclusiveDays, parseRange } from '@/lib/search-reporting/range';
import {
    NOT_COLLECTED_DETAIL,
    NOT_COLLECTED_REASON,
    type BlockReceipt,
    type DayPoint,
    type GrainSlot,
    type SearchReportingResponse,
    type SurfaceFilter,
} from '@/lib/search-reporting/types';

export const SECTION_IDS = ['summary', 'queries', 'cities', 'movers', 'pages', 'tracker'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const DEFAULT_RECEIPT_LIMIT = 30;
export const TABLE_RECEIPT_CAP = 24;
export const POSITION_LEGEND = [1, 3, 10, 20] as const;
export const NOT_COLLECTED_COPY = `${NOT_COLLECTED_REASON} · ${NOT_COLLECTED_DETAIL}`;

const CHART_WIDTH = 640;
const PAD_L = 48;
const PAD_R = 12;
const PANEL_HEIGHT = 128;
const PANEL_GAP = 36;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 6;

const SECTION_LABELS: Record<SectionId, string> = {
    summary: 'Summary',
    queries: 'Queries',
    cities: 'Cities',
    movers: 'Movers',
    pages: 'Pages',
    tracker: 'Tracker check',
};

export interface HealthChip {
    id: string;
    label: string;
    detail: string;
}

export interface InsightsBanner {
    id: 'partial' | 'stale' | 'empty';
    body: string;
    action: 'retry' | 'property' | null;
    actionLabel: string | null;
}

export interface ChartPointGeom {
    index: number;
    x: number;
    y: number | null;
    preliminary: boolean;
}

export interface ChartPanel {
    id: 'organic' | 'map';
    label: string;
    /** Resolved at render time. Organic is `--chart-1` unless the theme guard falls back. */
    colorToken: 'organic' | 'map';
    drawn: boolean;
    unavailable: string | null;
    zeroValue: string | null;
    zeroCopy: string | null;
    ticks: { y: number; label: string }[];
    solid: string;
    dashed: string;
    hatch: { x: number; y: number; width: number; height: number }[];
    points: ChartPointGeom[];
    top: number;
}

export interface ChartTableRow {
    date: string;
    label: string;
    status: 'final' | 'preliminary' | 'missing';
    organic: string;
    map: string;
}

export interface ChartModel {
    width: number;
    height: number;
    note: string | null;
    capLabel: string | null;
    panels: ChartPanel[];
    labels: { x: number; text: string }[];
    rows: ChartTableRow[];
    dates: { date: string; label: string; status: 'final' | 'preliminary' | 'missing' }[];
}

export interface KpiModel {
    id: string;
    label: string;
    value: string;
    hint: string;
    receipt: ReceiptInput | null;
    delta: FormattedDelta | null;
    splits: { label: string; value: string; colorToken: 'organic' | 'map' }[];
}

export interface SourceLine {
    source: string;
    rangeLabel: string;
    staleLabel: string | null;
}

export interface BandModel {
    id: string;
    label: string;
    queries: number;
    impressions: number;
    share: number;
}

export interface QueriesModel {
    surfaces: { id: 'organic' | 'map'; label: string; bands: BandModel[] }[];
    source: SourceLine | null;
}

export interface TableRowModel {
    key: string;
    cells: string[];
    position: number | null;
    receipt: ReceiptInput | null;
}

export interface CitiesModel {
    source: SourceLine | null;
    rows: TableRowModel[];
    hidden: number;
}

export interface MoversModel {
    source: SourceLine | null;
    rows: TableRowModel[];
    distorted: boolean;
}

export interface PagesModel {
    source: SourceLine | null;
    rows: TableRowModel[];
    hidden: number;
}

export interface TrackerModel {
    badge: number | null;
    verdict: string | null;
    rows: { query: string; tracker: string; gsc: string; status: string }[];
    dfs: string;
    ahrefsNote: string | null;
    empty: string | null;
    source: SourceLine | null;
}

export interface InsightsPresentation {
    example: boolean;
    connected: boolean;
    domain: string;
    property: string | null;
    connect: { body: string; action: string } | null;
    health: HealthChip[];
    banner: InsightsBanner | null;
    preliminaryLegend: string | null;
    grainNotes: string[];
    sections: { id: SectionId; label: string; badge: number | null }[];
    rangeLabel: string;
    rangeKey: string;
    priorLabel: string | null;
    priorReason: string | null;
    surface: SurfaceFilter;
    kpis: KpiModel[];
    chart: ChartModel | null;
    source: SourceLine | null;
    queries: QueriesModel | null;
    cities: CitiesModel | null;
    movers: MoversModel | null;
    pages: PagesModel | null;
    tracker: TrackerModel | null;
    /** Receipt triggers mounted on Summary, the default section. */
    receiptCount: number;
    positionHeader: string;
    positionLegend: string;
    staleAsOf: string | null;
}

const COUNT = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
    return COUNT.format(value);
}

export function formatDay(isoDate: string, withYear = false): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    if (!year || !month || !day) return isoDate;
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        year: withYear ? 'numeric' : undefined,
    }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatSpan(start: string, end: string): string {
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    if (sameYear) return `${formatDay(start)} – ${formatDay(end)}, ${end.slice(0, 4)}`;
    return `${formatDay(start, true)} – ${formatDay(end, true)}`;
}

export function formatSyncedAt(iso: string): string {
    const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(new Date(iso));
    return formatted.replace('PST', 'PT').replace('PDT', 'PT');
}

export function parseInsightsDeepLink(search: string): { range: string | null; section: SectionId | null } {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const rangeRaw = params.get('range');
    const parsed = rangeRaw ? parseRange(rangeRaw) : null;
    const range = rangeRaw && parsed && parsed.key === rangeRaw ? parsed.key : null;
    const sectionRaw = params.get('section');
    const section = SECTION_IDS.includes(sectionRaw as SectionId) ? sectionRaw as SectionId : null;
    return { range, section };
}

export function positionHeader(): string {
    return deltaColumnHeader('Avg position', 'position');
}

export function positionLegendLabel(): string {
    return `${POSITION_LEGEND.join(' · ')} · lower is better`;
}

/** Darker mix is a better (lower) position. One neutral hue, never a traffic-light scale. */
export function clusterHeatMix(position: number): number {
    const clamped = Math.min(50, Math.max(1, position));
    const t = (clamped - 1) / 49;
    return Math.round(42 - t * 30);
}

export function clusterHeatStyle(position: number): string {
    return `color-mix(in oklch, var(--foreground) ${clusterHeatMix(position)}%, var(--card))`;
}

export function niceStep(max: number): number {
    if (max <= 0) return 1;
    const rough = max / 3;
    const pow = 10 ** Math.floor(Math.log10(rough));
    const fraction = rough / pow;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * pow;
}

export function niceTicks(max: number): number[] {
    if (max <= 0) return [0, 1];
    const step = niceStep(max);
    const top = Math.ceil((max - 0.0001) / step) * step;
    const ticks: number[] = [];
    for (let value = 0; value <= top + step * 0.001; value += step) ticks.push(Math.round(value * 1000) / 1000);
    return ticks;
}

export function tickLabel(value: number): string {
    if (Math.abs(value) >= 1000) {
        const scaled = value / 1000;
        const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
        return `${text}k`;
    }
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

export function chartAnnouncement(
    dateLabel: string,
    status: 'final' | 'preliminary' | 'missing',
    impressions: number | null,
): string {
    if (status === 'missing' || impressions == null) return `${dateLabel} · missing · no impressions`;
    return `${dateLabel} · ${status} · ${formatCount(impressions)} impressions`;
}

function roundCoord(value: number): number {
    return Math.round(value * 10) / 10;
}

/** Break the path on a gap. Preliminary segments are a separate dashed path. */
export function strokePaths(points: { x: number; y: number | null; preliminary: boolean }[]): { solid: string; dashed: string } {
    let solid = '';
    let dashed = '';
    let mode: 'solid' | 'dashed' | null = null;
    points.forEach((point, index) => {
        if (point.y == null) {
            mode = null;
            return;
        }
        const prev = index > 0 ? points[index - 1] : null;
        const nextMode: 'solid' | 'dashed' = point.preliminary || prev?.preliminary === true ? 'dashed' : 'solid';
        const broken = !prev || prev.y == null || mode !== nextMode;
        const bucket = nextMode === 'dashed' ? 'dashed' : 'solid';
        const command = broken && prev && prev.y != null && mode !== nextMode
            ? `M ${roundCoord(prev.x)} ${roundCoord(prev.y)} L ${roundCoord(point.x)} ${roundCoord(point.y)}`
            : broken
                ? `M ${roundCoord(point.x)} ${roundCoord(point.y)}`
                : ` L ${roundCoord(point.x)} ${roundCoord(point.y)}`;
        if (bucket === 'dashed') dashed += command;
        else solid += command;
        mode = nextMode;
    });
    return { solid: solid.trim(), dashed: dashed.trim() };
}

export function connectPanel(domain: string): { body: string; action: string } {
    return {
        body: `Search Console isn’t connected. Search Insights runs on Google’s own data for ${domain}. Connect it once and we load up to 16 months of history.`,
        action: 'Connect Search Console',
    };
}

export function emptyWindowCopy(domain: string, windowLabel: string): string {
    return `Connected, but Google recorded no impressions for ${domain} in ${windowLabel}. That’s Google’s number, not missing data.`;
}

export function mapZeroCopy(windowLabel: string): string {
    return `Your Business Profile link didn’t appear in Search in ${windowLabel}.`;
}

export function partialBanner(historyStart: string, windowDays: number): string {
    const until = dateOffset(historyStart, windowDays * 2);
    return `History starts ${formatDay(historyStart, true)}. Comparisons need a full prior window, so changes are hidden until ${formatDay(until, true)}.`;
}

export function staleBanner(syncedAt: string, now: Date): string {
    const days = Math.max(0, Math.floor((now.getTime() - new Date(syncedAt).getTime()) / 86_400_000));
    const age = days === 1 ? '1 day' : `${days} days`;
    return `Search Console last synced ${formatSyncedAt(syncedAt)} (${age} ago). Numbers below are as of that sync.`;
}

export function preliminaryLegend(dates: string[]): string | null {
    if (dates.length === 0) return null;
    const sorted = [...dates].sort();
    const start = formatDay(sorted[0]);
    const end = formatDay(sorted[sorted.length - 1]);
    const startMonth = start.slice(0, start.lastIndexOf(' '));
    const endDay = end.slice(end.lastIndexOf(' ') + 1);
    const label = sorted.length === 1 || start === end
        ? start
        : end.startsWith(`${startMonth} `)
            ? `${start}–${endDay}`
            : `${start}–${end}`;
    return `${label} preliminary · not in totals`;
}

function grainNote(label: string, slot: GrainSlot | null | undefined): string | null {
    if (!slot || slot.available) return null;
    if (slot.reason === NOT_COLLECTED_REASON) return `${label} · ${NOT_COLLECTED_COPY}`;
    const detail = slot.detail ? `${slot.reason ?? 'Partial'} · ${slot.detail}` : (slot.reason ?? NOT_COLLECTED_COPY);
    return `${label} · ${detail}`;
}

type SeriesKind = 'absent' | 'missing' | 'empty' | 'data';

function seriesKind(series: DayPoint[] | null | undefined): SeriesKind {
    if (!series) return 'absent';
    const present = series.filter(point => !point.missing && point.impressions != null);
    if (present.length === 0) return 'missing';
    if (present.every(point => point.impressions === 0)) return 'empty';
    return 'data';
}

function receiptRange(receipt: BlockReceipt | null | undefined): { start: string; end: string } | null {
    const [start, end] = receipt?.range.split('/') ?? [];
    if (!start || !end) return null;
    return { start, end };
}

function sourceLine(response: SearchReportingResponse, receipt: BlockReceipt | null | undefined): SourceLine | null {
    const span = receiptRange(receipt);
    if (!receipt || !span) return null;
    return {
        source: receipt.source,
        rangeLabel: `${formatSpan(span.start, span.end)}${receipt.final ? ' · final' : ' · preliminary'}`,
        staleLabel: response.freshness.state === 'stale' ? response.freshness.asOf : null,
    };
}

function freshnessLine(response: SearchReportingResponse, receipt: BlockReceipt): string {
    if (response.freshness.state === 'stale') {
        return response.freshness.asOf ? `${response.freshness.copy} ${response.freshness.asOf}` : response.freshness.copy;
    }
    if (!receipt.final) return 'Preliminary · Google may still change these days';
    return receipt.synced_at ? `Final · synced ${formatSyncedAt(receipt.synced_at)}` : 'Final';
}

function metricReceipt(
    response: SearchReportingResponse,
    receipt: BlockReceipt,
    title: string,
    value: string,
    clientId: string | null,
): ReceiptInput {
    const span = receiptRange(receipt);
    return {
        title,
        value,
        freshness: freshnessLine(response, receipt),
        source: receipt.source,
        property: response.property,
        dates: span ? formatSpan(span.start, span.end) : receipt.range,
        method: receipt.method,
        audience: 'staff',
        tier: 'A',
        tag: receipt.final ? null : 'prelim',
        clientId,
        range: response.range?.key ?? null,
    };
}

function historyStartDate(series: DayPoint[] | null | undefined): string | null {
    if (!series || series.length === 0 || !series[0].missing) return null;
    return series.find(point => !point.missing)?.date ?? null;
}

function pointStatus(point: DayPoint | undefined): 'final' | 'preliminary' | 'missing' {
    if (!point || point.missing || point.impressions == null) return 'missing';
    return point.preliminary ? 'preliminary' : 'final';
}

function cellCount(point: DayPoint | undefined): string {
    if (!point || point.missing || point.impressions == null) return '—';
    return formatCount(point.impressions);
}

interface AxisCap {
    peak: number;
    date: string;
    axisMax: number;
}

function axisCap(series: DayPoint[]): AxisCap | null {
    const present = series.filter(point => !point.missing && point.impressions != null && point.impressions > 0);
    if (present.length < 2) return null;
    const sorted = [...present].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0));
    const peak = sorted[0];
    const next = sorted[1].impressions ?? 0;
    if (next <= 0 || (peak.impressions ?? 0) < next * 4) return null;
    const ticks = niceTicks(next);
    const axisMax = ticks[ticks.length - 1] ?? next;
    if (axisMax >= (peak.impressions ?? 0)) return null;
    return { peak: peak.impressions ?? 0, date: peak.date, axisMax };
}

function buildPanel(
    id: 'organic' | 'map',
    label: string,
    series: DayPoint[] | null | undefined,
    index: number,
    cap: AxisCap | null,
): ChartPanel {
    const top = index * (PANEL_HEIGHT + PANEL_GAP);
    const kind = seriesKind(series);
    const base = {
        id,
        label,
        colorToken: id,
        top,
        drawn: false,
        unavailable: null as string | null,
        zeroValue: null as string | null,
        zeroCopy: null as string | null,
        ticks: [] as { y: number; label: string }[],
        solid: '',
        dashed: '',
        hatch: [] as ChartPanel['hatch'],
        points: [] as ChartPointGeom[],
    };
    if (kind === 'absent') return { ...base, unavailable: NOT_COLLECTED_COPY };
    if (kind === 'missing') return { ...base, unavailable: 'No saved days in this window.' };
    if (kind === 'empty' || !series) return { ...base, zeroValue: '0', unavailable: null };
    const values = series.map(point => (point.missing || point.impressions == null ? null : point.impressions));
    const peak = Math.max(...values.filter((value): value is number => value != null), 0);
    const axisMax = cap?.axisMax ?? niceTicks(peak).at(-1) ?? 1;
    const plotHeight = PANEL_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
    const yOf = (value: number) => top + PLOT_TOP + plotHeight - (Math.min(value, axisMax) / axisMax) * plotHeight;
    const xOf = (pointIndex: number) => {
        if (series.length <= 1) return PAD_L + (CHART_WIDTH - PAD_L - PAD_R) / 2;
        return PAD_L + (pointIndex / (series.length - 1)) * (CHART_WIDTH - PAD_L - PAD_R);
    };
    const ticks = niceTicks(axisMax).map(value => ({ y: roundCoord(yOf(value)), label: tickLabel(value) }));
    const points = series.map((point, pointIndex) => ({
        index: pointIndex,
        x: roundCoord(xOf(pointIndex)),
        y: point.missing || point.impressions == null ? null : roundCoord(yOf(point.impressions)),
        preliminary: point.preliminary,
    }));
    const paths = strokePaths(points);
    const slot = series.length <= 1 ? 8 : (CHART_WIDTH - PAD_L - PAD_R) / (series.length - 1) / 2;
    const hatch = series.flatMap((point, pointIndex) => {
        if (!point.preliminary) return [];
        const x = xOf(pointIndex);
        return [{
            x: roundCoord(x - slot),
            y: top + PLOT_TOP,
            width: roundCoord(slot * 2),
            height: plotHeight,
        }];
    });
    return { ...base, drawn: true, ticks, solid: paths.solid, dashed: paths.dashed, hatch, points };
}

function buildChart(response: SearchReportingResponse): ChartModel | null {
    const summary = response.summary;
    const range = response.range;
    if (!summary || !range) return null;
    const organic = response.surface === 'map' ? null : summary.series.organic;
    const map = response.surface === 'organic' ? null : summary.series.map;
    const organicKind = seriesKind(organic);
    const mapKind = seriesKind(map);
    if (organicKind !== 'data' && mapKind !== 'data') return null;
    const panels: ChartPanel[] = [];
    if (response.surface !== 'map') {
        const cap = organic && organicKind === 'data' ? axisCap(organic) : null;
        panels.push(buildPanel('organic', 'Organic', organic, panels.length, cap));
    }
    if (response.surface !== 'organic') {
        const cap = map && mapKind === 'data' ? axisCap(map) : null;
        panels.push(buildPanel('map', 'Map pack', map, panels.length, cap));
    }
    const windowLabel = formatSpan(range.start, range.end);
    for (const panel of panels) {
        if (!panel.zeroValue) continue;
        panel.zeroCopy = panel.id === 'map' ? mapZeroCopy(windowLabel) : 'Organic recorded no impressions in this window.';
    }
    const spine = (organicKind === 'data' ? organic : map) ?? [];
    const labels = spine.length === 0 ? [] : [0, Math.floor((spine.length - 1) / 2), spine.length - 1]
        .filter((value, index, all) => all.indexOf(value) === index)
        .map(index => {
            const point = spine[index];
            const x = spine.length <= 1 ? PAD_L : PAD_L + (index / (spine.length - 1)) * (CHART_WIDTH - PAD_L - PAD_R);
            return { x: roundCoord(x), text: formatDay(point.date) };
        });
    const cap = (organic && organicKind === 'data' ? axisCap(organic) : null)
        ?? (map && mapKind === 'data' ? axisCap(map) : null);
    const note = summary.comparison.distorted && summary.comparison.reason
        ? `Prior period hidden: ${formatSpan(range.prior.start, range.prior.end)} · ${summary.comparison.reason}`
        : null;
    const rows: ChartTableRow[] = spine.map((point, index) => ({
        date: point.date,
        label: formatDay(point.date),
        status: pointStatus(point),
        organic: cellCount(organic?.[index]),
        map: cellCount(map?.[index]),
    }));
    return {
        width: CHART_WIDTH,
        height: panels.length * PANEL_HEIGHT + Math.max(0, panels.length - 1) * PANEL_GAP + 28,
        note,
        capLabel: cap ? `Axis capped · peak ${formatCount(cap.peak)} on ${formatDay(cap.date)}` : null,
        panels,
        labels,
        rows,
        dates: spine.map(point => ({ date: point.date, label: formatDay(point.date), status: pointStatus(point) })),
    };
}

function deltaFor(response: SearchReportingResponse, field: 'impressions' | 'position'): FormattedDelta | null {
    const summary = response.summary;
    if (!summary) return null;
    const selected = response.surface === 'organic'
        ? summary.seriesComparisons.organic
        : response.surface === 'map'
            ? summary.seriesComparisons.map
            : summary.seriesComparisons.allGoogleSearch;
    return selected?.[field] ?? summary.comparison[field];
}

function headline(response: SearchReportingResponse, field: 'impressions' | 'clicks'): { label: string; value: number } | null {
    const totals = response.summary?.totals;
    if (!totals) return null;
    const picked = response.surface === 'organic' ? totals.organic : response.surface === 'map' ? totals.map : totals.allGoogleSearch;
    if (!picked) return null;
    const label = field === 'impressions' ? `Impressions · ${picked.label}` : `Clicks to site · ${picked.label}`;
    return { label, value: picked[field] };
}

function bandShare(bands: { id: string; label: string; queries: number; impressions: number; clicks: number }[]): BandModel[] {
    const total = bands.reduce((sum, band) => sum + band.impressions, 0);
    return bands.map(band => ({
        id: band.id,
        label: band.label,
        queries: band.queries,
        impressions: band.impressions,
        share: total > 0 ? band.impressions / total : 0,
    }));
}

function rowReceipt(
    response: SearchReportingResponse,
    receipt: BlockReceipt,
    title: string,
    value: string,
    clientId: string | null,
): ReceiptInput {
    return { ...metricReceipt(response, receipt, title, value, clientId), tier: 'B' };
}

export function presentInsights(
    response: SearchReportingResponse,
    options: { example?: boolean; domain?: string; now?: Date; clientId?: string | null } = {},
): InsightsPresentation {
    const now = options.now ?? new Date();
    const domain = response.property || options.domain?.trim() || 'this site';
    const clientId = options.clientId ?? null;
    const position = positionHeader();
    const connected = response.connected && response.range != null;
    const range = response.range;
    const windowLabel = range ? formatSpan(range.start, range.end) : '';
    const rangeLabel = !range
        ? ''
        : range.preset === '28d'
            ? `${windowLabel} · last 28 final days`
            : `${windowLabel} · calendar month`;
    const grainNotes = [
        grainNote('Organic totals', response.grains?.pageOrganic),
        grainNote('Device', response.grains?.device),
    ].filter((note): note is string => Boolean(note));
    if (response.connected && response.queries == null && response.grains?.device.requested == null) {
        grainNotes.push(`Queries · ${STATES_COPY.partialHistory}`);
    }

    const anomalyCount = response.tracker?.ahrefs.rows.filter(row => row.anomalyOpen).length ?? 0;
    const badge = response.tracker?.anomaly_open && anomalyCount > 0 ? anomalyCount : null;
    const sections = SECTION_IDS.map(id => ({
        id,
        label: SECTION_LABELS[id],
        badge: id === 'tracker' ? badge : null,
    }));

    if (!connected || !range) {
        return {
            example: options.example === true,
            connected: false,
            domain,
            property: response.property,
            connect: connectPanel(domain),
            health: [{ id: 'gsc', label: 'Search Console', detail: 'not connected' }],
            banner: null,
            preliminaryLegend: null,
            grainNotes: [],
            sections,
            rangeLabel: '',
            rangeKey: '28d',
            priorLabel: null,
            priorReason: null,
            surface: response.surface,
            kpis: [],
            chart: null,
            source: null,
            queries: null,
            cities: null,
            movers: null,
            pages: null,
            tracker: null,
            receiptCount: 0,
            positionHeader: position,
            positionLegend: positionLegendLabel(),
            staleAsOf: null,
        };
    }

    const summary = response.summary;
    const receipt = summary?.receipt ?? null;
    const preliminaryDates = summary?.mask.filter(item => item.reason === 'preliminary').map(item => item.date) ?? [];
    const organicStart = historyStartDate(summary?.series.organic);
    const mapStart = historyStartDate(summary?.series.map);
    const started = organicStart ?? mapStart;
    const windowDays = inclusiveDays(range.start, range.end);
    const reason = summary?.comparison.reason ?? null;
    let banner: InsightsBanner | null = null;
    if (response.freshness.state === 'stale') {
        banner = {
            id: 'stale',
            body: receipt?.synced_at ? staleBanner(receipt.synced_at, now) : response.freshness.copy,
            action: 'retry',
            actionLabel: 'Retry sync',
        };
    } else if (response.freshness.state === 'empty' || (seriesKind(summary?.series.organic) !== 'data' && seriesKind(summary?.series.map) !== 'data' && seriesKind(summary?.series.organic) === 'empty')) {
        banner = {
            id: 'empty',
            body: emptyWindowCopy(domain, windowLabel),
            action: response.property ? 'property' : null,
            actionLabel: response.property ? `Check property ${response.property}` : null,
        };
    } else if (response.freshness.copy === STATES_COPY.partialHistory && response.freshness.tag == null) {
        banner = {
            id: 'partial',
            body: STATES_COPY.partialHistory,
            action: null,
            actionLabel: null,
        };
    } else if (response.freshness.state === 'partial' || reason === 'history starts mid-period' || reason === 'partial period') {
        banner = {
            id: 'partial',
            body: started ? partialBanner(started, windowDays) : 'Comparisons need a full prior window, so changes are hidden.',
            action: null,
            actionLabel: null,
        };
    }

    const synced = receipt?.synced_at ? formatSyncedAt(receipt.synced_at) : null;
    const health: HealthChip[] = [
        {
            id: 'gsc',
            label: 'Search Console',
            detail: response.freshness.state === 'fresh' && synced
                ? `synced ${synced}`
                : response.freshness.state === 'stale'
                    ? (response.freshness.asOf ?? 'stale')
                    : response.freshness.state,
        },
        {
            id: 'history',
            label: 'History depth',
            detail: `${range.finality.days_present} of ${range.finality.days_expected} days · ${windowLabel}`,
        },
        { id: 'ga4', label: 'GA4', detail: '— · not in this read' },
        { id: 'gbp', label: 'Business Profile', detail: '— · calls and directions aren’t in this read' },
        { id: 'calls', label: 'Call tracking', detail: '— · not in this read' },
        {
            id: 'dfs',
            label: 'DataForSEO',
            detail: response.tracker?.dfs.reason === NOT_COLLECTED_REASON ? NOT_COLLECTED_COPY : 'spot check',
        },
        {
            id: 'ahrefs',
            label: 'Ahrefs',
            detail: (response.tracker?.ahrefs.rows.length ?? 0) > 0
                ? `reference · ${response.tracker?.ahrefs.rows.length} queries`
                : 'not connected',
        },
    ];

    const kpis: KpiModel[] = [];
    const impressions = headline(response, 'impressions');
    const clicks = headline(response, 'clicks');
    if (impressions && receipt) {
        kpis.push({
            id: 'impressions',
            label: impressions.label,
            value: formatCount(impressions.value),
            hint: 'Times shown in Google Search',
            receipt: metricReceipt(response, receipt, impressions.label, formatCount(impressions.value), clientId),
            delta: deltaFor(response, 'impressions'),
            splits: [],
        });
    }
    if (clicks && receipt) {
        kpis.push({
            id: 'clicks',
            label: clicks.label,
            value: formatCount(clicks.value),
            hint: 'Clicks to the website',
            receipt: metricReceipt(response, receipt, clicks.label, formatCount(clicks.value), clientId),
            delta: null,
            splits: [],
        });
    }

    const organicBands = response.queries?.bands.organic;
    const mapBands = response.queries?.bands.map;
    const distinct: KpiModel['splits'] = [];
    if (organicBands && response.surface !== 'map') {
        distinct.push({ label: 'Organic', value: formatCount(organicBands.reduce((sum, band) => sum + band.queries, 0)), colorToken: 'organic' });
    }
    if (mapBands && response.surface !== 'organic') {
        distinct.push({ label: 'Map pack', value: formatCount(mapBands.reduce((sum, band) => sum + band.queries, 0)), colorToken: 'map' });
    }
    if (distinct.length > 0) {
        kpis.push({
            id: 'queries',
            label: 'Distinct search queries',
            value: distinct.map(split => split.value).join(' · '),
            hint: 'Counted inside each surface',
            receipt: null,
            delta: null,
            splits: distinct,
        });
    }
    const topSplits: KpiModel['splits'] = [];
    const topOf = (bands: NonNullable<typeof organicBands>, token: 'organic' | 'map', label: string) => {
        const top = bands.filter(band => band.id === '1-3' || band.id === '4-10').reduce((sum, band) => sum + band.queries, 0);
        topSplits.push({ label, value: formatCount(top), colorToken: token });
    };
    if (organicBands && response.surface !== 'map') topOf(organicBands, 'organic', 'Organic');
    if (mapBands && response.surface !== 'organic') topOf(mapBands, 'map', 'Map pack');
    if (topSplits.length > 0) {
        kpis.push({
            id: 'top10',
            label: 'Queries averaging top 10',
            value: topSplits.map(split => split.value).join(' · '),
            hint: position,
            receipt: null,
            delta: null,
            splits: topSplits,
        });
    }

    const queries: QueriesModel | null = response.queries ? {
        source: sourceLine(response, response.queries.receipt),
        surfaces: [
            organicBands && response.surface !== 'map' ? { id: 'organic' as const, label: 'Organic', bands: bandShare(organicBands) } : null,
            mapBands && response.surface !== 'organic' ? { id: 'map' as const, label: 'Map pack', bands: bandShare(mapBands) } : null,
        ].filter((item): item is QueriesModel['surfaces'][number] => Boolean(item)),
    } : null;

    const cityRows = response.cities?.rows ?? [];
    const cities: CitiesModel | null = response.cities ? {
        source: sourceLine(response, response.cities.receipt),
        rows: cityRows.slice(0, TABLE_RECEIPT_CAP).map(row => ({
            key: `${row.surface}:${row.city}`,
            cells: [
                row.city,
                row.surface === 'gbp_link' ? 'Map pack' : 'Organic',
                row.display,
                row.reason ?? '',
            ],
            position: null,
            receipt: row.shown && response.cities
                ? rowReceipt(response, response.cities.receipt, `${row.city} impressions`, row.display, clientId)
                : null,
        })),
        hidden: Math.max(0, cityRows.length - TABLE_RECEIPT_CAP),
    } : null;

    const movers: MoversModel | null = response.movers ? {
        source: sourceLine(response, response.movers.receipt),
        distorted: response.movers.comparison.distorted,
        rows: response.movers.rows.slice(0, TABLE_RECEIPT_CAP).map(row => ({
            key: `${row.surface}:${row.query}`,
            cells: [
                row.query,
                row.surface === 'gbp_link' ? 'Map pack' : 'Organic',
                formatCount(row.impressions),
                response.movers?.comparison.distorted ? '—' : formatCount(row.priorImpressions),
                row.tag === 'mix_shift' ? 'mix shift' : row.kind,
            ],
            position: null,
            receipt: null,
        })),
    } : null;

    const pageRows = response.pages?.rows ?? [];
    const pages: PagesModel | null = response.pages ? {
        source: sourceLine(response, response.pages.receipt),
        rows: pageRows.slice(0, TABLE_RECEIPT_CAP).map(row => ({
            key: `${row.surface}:${row.page}`,
            cells: [
                row.label,
                row.surface === 'gbp_link' ? 'Map pack' : 'Organic',
                formatCount(row.impressions),
                formatCount(row.clicks),
                row.position == null ? '—' : row.position.toFixed(1),
            ],
            position: row.position,
            receipt: rowReceipt(response, response.pages!.receipt, `${row.label} impressions`, formatCount(row.impressions), clientId),
        })),
        hidden: Math.max(0, pageRows.length - TABLE_RECEIPT_CAP),
    } : null;

    const trackerRows = response.tracker?.ahrefs.rows ?? [];
    const stillVisible = trackerRows.some(row => row.gscOrganicPosition != null);
    const tracker: TrackerModel | null = response.tracker ? {
        badge,
        verdict: response.tracker.anomaly_open
            ? stillVisible
                ? `Ahrefs disagrees on ${anomalyCount} ${anomalyCount === 1 ? 'query' : 'queries'}. Google still shows the site.`
                : `Ahrefs disagrees on ${anomalyCount} ${anomalyCount === 1 ? 'query' : 'queries'}.`
            : null,
        rows: trackerRows.map(row => ({
            query: row.query,
            tracker: row.trackerPosition == null ? '—' : row.trackerPosition.toFixed(1),
            gsc: row.gscOrganicPosition == null ? '—' : row.gscOrganicPosition.toFixed(1),
            status: row.anomalyOpen ? 'Disagrees with Google' : 'Still visible on Google',
        })),
        dfs: response.tracker.dfs.reason === NOT_COLLECTED_REASON ? NOT_COLLECTED_COPY : response.tracker.dfs.detail,
        ahrefsNote: response.tracker.ahrefs.note,
        empty: trackerRows.length === 0 ? 'No tracked keywords for this client.' : null,
        source: sourceLine(response, response.tracker.ahrefs.receipt),
    } : null;

    const bothEmpty = seriesKind(summary?.series.organic) !== 'data' && seriesKind(summary?.series.map) !== 'data'
        && (seriesKind(summary?.series.organic) === 'empty' || seriesKind(summary?.series.map) === 'empty');

    return {
        example: options.example === true,
        connected: true,
        domain,
        property: response.property,
        connect: null,
        health,
        banner,
        preliminaryLegend: preliminaryLegend(preliminaryDates),
        grainNotes,
        sections,
        rangeLabel,
        rangeKey: range.key,
        priorLabel: formatSpan(range.prior.start, range.prior.end),
        priorReason: summary?.comparison.distorted ? reason : null,
        surface: response.surface,
        kpis,
        chart: bothEmpty ? null : buildChart(response),
        source: sourceLine(response, receipt),
        queries,
        cities,
        movers,
        pages,
        tracker,
        receiptCount: kpis.filter(item => item.receipt).length,
        positionHeader: position,
        positionLegend: positionLegendLabel(),
        staleAsOf: response.freshness.state === 'stale' ? response.freshness.asOf : null,
    };
}
