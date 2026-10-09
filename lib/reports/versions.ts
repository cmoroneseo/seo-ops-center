/**
 * Frozen report snapshot. Built only when a report is approved or corrected.
 * Missing numbers stay null. A stored zero stays zero. The hash is the
 * canonical JSON of the snapshot, so key order cannot change the identity.
 */

import { createHash } from 'node:crypto';
import { monthFinality } from '@/lib/gsc/monthly';
import { monthBounds, previousMonth } from '@/lib/sync/months';
import { blocksForClientRender, type Block, type ReportSectionsField } from './blocks';
import { clientSafeMetricData, METRIC_DEFS, type ReportSourceKey } from './sections';

export type VersionReason = 'approval' | 'correction';

export interface FrozenMetric {
    source: string;
    metricMonth: string;
    data: Record<string, unknown>;
    provenance: unknown;
    sourceType: string | null;
    updatedAt: string | null;
}

export interface FrozenGscDay {
    date: string;
    present: boolean;
    isIncomplete: boolean;
    clicks: number | null;
    impressions: number | null;
}

export interface FrozenLedgerRow {
    id: string;
    title: string;
    shippedOn: string;
    publishedUrl: string;
    verdict: string;
    chip: string;
    detail: string;
    footnote: string | null;
}

export interface FrozenReceipt {
    source: string;
    title: string;
    value: number | null;
    display: string;
    final: boolean | null;
    syncedAt: string | null;
    range: { start: string; end: string };
    note: string | null;
}

export interface ReportVersionSnapshot {
    schemaVersion: 1;
    reportId: string;
    organizationId: string;
    clientId: string;
    reportMonth: string;
    title: string;
    capturedAt: string;
    reason: VersionReason;
    correctionNote: string | null;
    copy: {
        executiveSummary: string;
        recommendations: string;
        whatWeDid: string | null;
    };
    metrics: FrozenMetric[];
    gscSeries: FrozenGscDay[];
    ledgerRows: FrozenLedgerRow[];
    receipts: FrozenReceipt[];
    portal: Record<string, unknown>;
}

export interface MetricInput {
    source: string;
    metricMonth: string;
    data: Record<string, unknown> | null;
    provenance?: unknown;
    sourceType?: string | null;
    updatedAt?: string | null;
}

export interface GscDayInput {
    date: string;
    isIncomplete: boolean;
    /** Null on a saved day with no property row: that day is a real zero. */
    property: { clicks: number; impressions: number } | null;
}

export interface SnapshotInput {
    reportId: string;
    organizationId: string;
    clientId: string;
    reportMonth: string;
    title: string;
    executiveSummary: string;
    recommendations: string;
    sections: ReportSectionsField;
    capturedAt: string;
    reason: VersionReason;
    correctionNote: string | null;
    amNote: string | null;
    metrics: MetricInput[];
    gscDays: GscDayInput[];
    gscFinal: boolean;
    ledgerRows: FrozenLedgerRow[];
    planSnapshot?: Record<string, unknown> | null;
}

export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function contentHash(snapshot: unknown): string {
    return createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

/** The approved freeze is what the portal renders. A live capture is only the fallback. */
export function chooseReportSnapshot<T>(approved: T | null, live: T | null): T | null {
    return approved ?? live;
}

export function clientWhatWeDid(summary: string, note: string | null): string {
    const trimmed = note?.trim() ?? '';
    if (!trimmed) return summary;
    const body = summary.trim();
    const section = `What we did\n${trimmed}`;
    return body ? `${body}\n\n${section}` : section;
}

function finite(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function display(value: number | null): string {
    if (value == null) return '—';
    if (value === 0) return '0';
    return String(value);
}

export function gscMonthReadout(month: string, days: GscDayInput[]): {
    final: boolean;
    daysPresent: number;
    daysExpected: number;
    clicks: number | null;
    impressions: number | null;
    series: FrozenGscDay[];
} {
    const bounds = monthBounds(month);
    const byDate = new Map<string, GscDayInput>();
    for (const day of days) {
        if (day.date < bounds.start || day.date > bounds.end) continue;
        byDate.set(day.date, day);
    }
    const finality = monthFinality(month, [...byDate.values()].map(day => ({ date: day.date, isIncomplete: day.isIncomplete })));
    const series: FrozenGscDay[] = [];
    let clicks = 0;
    let impressions = 0;
    let sawPresent = false;
    for (let index = 0; index < bounds.days; index += 1) {
        const date = index === 0 ? bounds.start : offset(bounds.start, index);
        const day = byDate.get(date);
        if (!day) {
            series.push({ date, present: false, isIncomplete: false, clicks: null, impressions: null });
            continue;
        }
        sawPresent = true;
        const dayClicks = day.property ? day.property.clicks : 0;
        const dayImpressions = day.property ? day.property.impressions : 0;
        clicks += dayClicks;
        impressions += dayImpressions;
        series.push({
            date,
            present: true,
            isIncomplete: day.isIncomplete,
            clicks: dayClicks,
            impressions: dayImpressions,
        });
    }
    return {
        final: finality.final,
        daysPresent: finality.days_present,
        daysExpected: finality.days_expected,
        clicks: sawPresent ? clicks : null,
        impressions: sawPresent ? impressions : null,
        series,
    };
}

function offset(iso: string, days: number): string {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function safeMetric(row: MetricInput): FrozenMetric {
    return {
        source: row.source,
        metricMonth: row.metricMonth,
        data: clientSafeMetricData(row.data ?? {}),
        provenance: row.provenance ?? null,
        sourceType: row.sourceType ?? null,
        updatedAt: row.updatedAt ?? null,
    };
}

function receiptsFor(input: SnapshotInput, series: ReturnType<typeof gscMonthReadout>): FrozenReceipt[] {
    const bounds = monthBounds(input.reportMonth);
    const range = { start: bounds.start, end: bounds.end };
    const current = new Map(input.metrics.filter(row => row.metricMonth === input.reportMonth).map(row => [row.source, safeMetric(row)]));
    const receipts: FrozenReceipt[] = [];
    const sources: ReportSourceKey[] = ['gsc', 'ga4', 'gbp', 'ahrefs'];
    for (const source of sources) {
        const row = current.get(source);
        for (const def of METRIC_DEFS[source]) {
            let value: number | null = null;
            let final: boolean | null = null;
            let note: string | null = null;
            if (source === 'gsc' && (def.key === 'organic_clicks' || def.key === 'impressions') && series.daysPresent > 0) {
                value = def.key === 'organic_clicks' ? series.clicks : series.impressions;
                final = series.final;
                note = series.final ? null : 'Missing days are not counted as zero.';
            } else if (row && Object.prototype.hasOwnProperty.call(row.data, def.key)) {
                value = finite(row.data[def.key]);
                const provenance = row.provenance as { finality?: { final?: boolean } } | null;
                final = typeof provenance?.finality?.final === 'boolean' ? provenance.finality.final : null;
            }
            if (source !== 'gsc' && !row) continue;
            if (source === 'gsc' && def.key !== 'organic_clicks' && def.key !== 'impressions' && !row) continue;
            receipts.push({
                source,
                title: def.label,
                value,
                display: display(value),
                final,
                syncedAt: row?.updatedAt ?? null,
                range,
                note,
            });
        }
    }
    return receipts;
}

export function assembleReportSnapshot(input: SnapshotInput): ReportVersionSnapshot {
    const readout = gscMonthReadout(input.reportMonth, input.gscDays);
    const note = input.amNote?.trim() || null;
    const correction = input.reason === 'correction' ? input.correctionNote?.trim() || null : null;
    const executiveSummary = clientWhatWeDid(input.executiveSummary, note);
    const metrics = input.metrics
        .filter(row => row.metricMonth && row.metricMonth <= input.reportMonth)
        .map(safeMetric)
        .sort((left, right) => left.metricMonth.localeCompare(right.metricMonth) || left.source.localeCompare(right.source));
    const blocks = blocksForClientRender(input.sections);
    const currentRows = metrics.filter(row => row.metricMonth === input.reportMonth);
    const previous = previousMonth(input.reportMonth);
    const history: Record<string, { month: string; data: Record<string, unknown> }[]> = {};
    for (const row of metrics) {
        (history[row.source] ??= []).push({ month: row.metricMonth, data: row.data });
    }
    for (const source of Object.keys(history)) {
        history[source] = history[source].sort((left, right) => left.month.localeCompare(right.month)).slice(-12);
    }
    const portal = {
        id: input.reportId,
        title: input.title,
        reportMonth: input.reportMonth,
        sharedAt: '',
        executiveSummary,
        recommendations: input.recommendations,
        whatWeDid: note,
        correctionNote: correction,
        sections: { version: 2 as const, blocks },
        metrics: {
            current: Object.fromEntries(currentRows.map(row => [row.source, row.data])),
            previous: Object.fromEntries(metrics.filter(row => row.metricMonth === previous).map(row => [row.source, row.data])),
            updatedAt: Object.fromEntries(currentRows.map(row => [row.source, row.updatedAt])),
        },
        history,
        planSnapshot: input.planSnapshot ?? null,
    };
    return {
        schemaVersion: 1,
        reportId: input.reportId,
        organizationId: input.organizationId,
        clientId: input.clientId,
        reportMonth: input.reportMonth,
        title: input.title,
        capturedAt: input.capturedAt,
        reason: input.reason,
        correctionNote: correction,
        copy: {
            executiveSummary: input.executiveSummary,
            recommendations: input.recommendations,
            whatWeDid: note,
        },
        metrics,
        gscSeries: readout.series,
        ledgerRows: input.ledgerRows,
        receipts: receiptsFor(input, readout),
        portal,
    };
}

export function copyTextForSnapshot(input: Pick<SnapshotInput, 'executiveSummary' | 'recommendations' | 'amNote' | 'sections'>): { text: string; blocks: Block[] } {
    const blocks = blocksForClientRender(input.sections);
    const blockText = blocks.flatMap(block => ['text', 'content', 'heading', 'caption', 'label', 'title', 'subtitle']
        .map(key => block.props?.[key])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
    const text = [clientWhatWeDid(input.executiveSummary, input.amNote), input.recommendations, ...blockText].filter(Boolean).join('\n');
    return { text, blocks };
}
