/**
 * Campaign measurement for the selected client.
 *
 * Sitewide clicks use the Search dashboard window: 28 days ending on the last
 * final day, then the 28 days before that. The total is `periodMetrics` over
 * the property-grain series. A missing or incomplete window stays unmeasured.
 * Monthly Business Profile rows stay on their own month and are never added in.
 * The strategy-builder plan is not an input.
 * Page clicks are a separate series (`pages.ts`) and are never added here.
 */

import type { ClientProject } from '@/lib/types';
import type { HistoryDay, HistoryRow } from '@/lib/gsc/insights';
import { formatDelta } from '@/lib/reporting/delta';
import {
    formatCount,
    formatSpan,
    pairedWindows,
    periodMetrics,
    propertySeries,
} from '@/lib/search-dashboard/model';
import { coverWindow } from '@/lib/search-reporting/range';
import { isClosedMonth, monthBounds, previousMonth } from '@/lib/sync/months';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type MeasurementReason = 'measured' | 'missing' | 'unavailable' | 'incomplete';

export interface CampaignSitewide {
    status: 'measurable' | 'not_measurable';
    reason: MeasurementReason;
    clicks: number | null;
    clicksLabel: string;
    priorClicks: number | null;
    deltaLabel: string | null;
    currentLabel: string | null;
    priorLabel: string | null;
    asOf: string | null;
    points: { date: string; clicks: number }[];
    baselineDaily: number | null;
    baselineCaption: string | null;
}

export interface CampaignLocalProfile {
    status: 'measurable' | 'not_measurable';
    label: string | null;
    value: number | null;
    valueLabel: string;
    priorValue: number | null;
    priorLabel: string | null;
    windowLabel: string | null;
}

export interface CampaignIdentity {
    startDate: string | null;
    startLabel: string | null;
    owner: string | null;
    scope: string | null;
}

export type PageSeriesStatus = 'ready' | 'missing' | 'unavailable' | 'incomplete';

/**
 * Page-grain Search Console for initiative URLs.
 * Kept off the property series so page clicks cannot join the sitewide total.
 * `ready` means the page grain was read and was not truncated. Other statuses
 * carry no rows, so a gap cannot be summed as zero.
 */
export interface CampaignPageSeries {
    status: PageSeriesStatus;
    days: HistoryDay[];
    rows: HistoryRow[];
}

export interface CampaignMeasurement {
    gsc: CampaignSitewide;
    gbp: CampaignLocalProfile;
    /** Null when the approval read did not succeed. Zero is a real empty count. */
    awaitingApproval: number | null;
    pages: CampaignPageSeries;
}

export interface CampaignIdentityInput {
    launchDate?: string | null;
    launchDateOverride?: string | null;
    onboardingDate?: string | null;
    campaignStart?: string | null;
    accountManager?: string | null;
    seoHours?: number | null;
    deliverablesSpec?: string | null;
}

export interface GbpMetricRow {
    metricMonth: string;
    data: Record<string, unknown>;
}

const LOCAL_METRICS: { key: string; label: string }[] = [
    { key: 'calls', label: 'Call-button taps' },
    { key: 'direction_requests', label: 'Directions' },
    { key: 'website_clicks', label: 'Website clicks' },
    { key: 'impressions', label: 'Impressions' },
];

export function emptySitewide(reason: Exclude<MeasurementReason, 'measured'> = 'missing'): CampaignSitewide {
    return {
        status: 'not_measurable',
        reason,
        clicks: null,
        clicksLabel: '—',
        priorClicks: null,
        deltaLabel: null,
        currentLabel: null,
        priorLabel: null,
        asOf: null,
        points: [],
        baselineDaily: null,
        baselineCaption: null,
    };
}

export function emptyLocalProfile(): CampaignLocalProfile {
    return {
        status: 'not_measurable',
        label: null,
        value: null,
        valueLabel: '—',
        priorValue: null,
        priorLabel: null,
        windowLabel: null,
    };
}

export const EMPTY_PAGE_SERIES: CampaignPageSeries = {
    status: 'unavailable',
    days: [],
    rows: [],
};

export const EMPTY_CAMPAIGN_MEASUREMENT: CampaignMeasurement = {
    gsc: emptySitewide('unavailable'),
    gbp: emptyLocalProfile(),
    awaitingApproval: null,
    pages: EMPTY_PAGE_SERIES,
};

function finiteNonNegative(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return value;
}

function dateOrNull(value: string | null | undefined): string | null {
    if (!value) return null;
    const day = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function formatCampaignDay(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return iso;
    const month = MONTHS[Number(match[2]) - 1] ?? iso;
    return `${month} ${Number(match[3])}, ${match[1]}`;
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

/**
 * Property-grain Search Console clicks for the Search dashboard's paired window.
 * Incomplete days and days without a property row stay unmeasured. They are not zero.
 */
export function campaignSitewide(input: {
    connected: boolean;
    days: readonly HistoryDay[];
    rows: readonly HistoryRow[];
    today: string;
}): CampaignSitewide {
    if (!input.connected) return emptySitewide('unavailable');
    const flags = input.days.map(day => ({ date: day.date, isIncomplete: Boolean(day.isIncomplete) }));
    const window = pairedWindows(flags, input.today);
    if (!window) return emptySitewide('missing');

    const coverage = coverWindow(window.current, flags);
    const currentPoints = propertySeries(input.days, input.rows, window.current);
    const current = periodMetrics(currentPoints);
    const currentComplete = coverage.final
        && currentPoints.length === coverage.daysExpected
        && currentPoints.every(point => point.clicks != null)
        && current.clicks != null;
    if (!currentComplete || current.clicks == null) return emptySitewide('incomplete');

    const points = currentPoints.map(point => ({ date: point.date, clicks: point.clicks as number }));
    const priorPoints = propertySeries(input.days, input.rows, window.prior);
    const prior = periodMetrics(priorPoints);
    const priorComplete = window.comparable
        && priorPoints.length > 0
        && priorPoints.every(point => point.clicks != null)
        && prior.clicks != null;
    const priorClicks = priorComplete ? prior.clicks : null;
    const baselineDaily = priorClicks == null ? null : priorClicks / priorPoints.length;
    const priorLabel = priorComplete ? formatSpan(window.prior.start, window.prior.end) : null;
    const currentLabel = formatSpan(window.current.start, window.current.end);

    return {
        status: 'measurable',
        reason: 'measured',
        clicks: current.clicks,
        clicksLabel: formatCount(current.clicks),
        priorClicks,
        deltaLabel: priorClicks == null ? null : baselineDelta(current.clicks, priorClicks),
        currentLabel,
        priorLabel,
        asOf: window.current.end,
        points,
        baselineDaily,
        baselineCaption: priorClicks == null || priorLabel == null
            ? null
            : `Baseline ${formatCount(priorClicks)} · ${priorLabel}. Dashed line is that window's daily average.`,
    };
}

function pickLocalMetric(data: Record<string, unknown>): { key: string; label: string; value: number } | null {
    for (const metric of LOCAL_METRICS) {
        const value = finiteNonNegative(data[metric.key]);
        if (value != null) return { key: metric.key, label: metric.label, value };
    }
    return null;
}

/** Latest closed Business Profile month. The open month is not a finished window. */
export function campaignLocalProfile(rows: readonly GbpMetricRow[], now: Date): CampaignLocalProfile {
    const closed = rows
        .filter(row => /^\d{4}-\d{2}$/.test(row.metricMonth) && isClosedMonth(row.metricMonth, now))
        .sort((a, b) => b.metricMonth.localeCompare(a.metricMonth));
    const latest = closed[0];
    if (!latest) return emptyLocalProfile();
    const metric = pickLocalMetric(latest.data);
    if (!metric) return emptyLocalProfile();
    let priorMonth: string;
    try {
        priorMonth = previousMonth(latest.metricMonth);
    } catch {
        return emptyLocalProfile();
    }
    const priorRow = closed.find(row => row.metricMonth === priorMonth);
    const priorValue = priorRow ? finiteNonNegative(priorRow.data[metric.key]) : null;
    let windowLabel: string | null = null;
    let priorLabel: string | null = null;
    try {
        const bounds = monthBounds(latest.metricMonth);
        windowLabel = formatSpan(bounds.start, bounds.end);
        if (priorValue != null) {
            const priorBounds = monthBounds(priorMonth);
            priorLabel = formatSpan(priorBounds.start, priorBounds.end);
        }
    } catch {
        return emptyLocalProfile();
    }
    return {
        status: 'measurable',
        label: metric.label,
        value: metric.value,
        valueLabel: formatCount(metric.value),
        priorValue,
        priorLabel,
        windowLabel,
    };
}

/**
 * Same documents the workspace canvas counts as awaiting a decision:
 * an in-review batch that was sent, and a doc that is pending or has changes requested.
 */
export function countAwaitingApproval(docs: readonly {
    batchStatus: string;
    sentAt?: string | null;
    status: string;
    archivedAt?: string | null;
}[]): number {
    return docs.filter(doc => {
        if (doc.archivedAt || doc.batchStatus !== 'in_review') return false;
        if (!doc.sentAt) return false;
        return doc.status === 'pending' || doc.status === 'changes_requested';
    }).length;
}

export function campaignIdentity(input: CampaignIdentityInput): CampaignIdentity {
    const override = dateOrNull(input.launchDateOverride);
    const launch = dateOrNull(input.launchDate);
    const campaign = dateOrNull(input.campaignStart);
    const onboarding = dateOrNull(input.onboardingDate);
    const startDate = override ?? launch ?? (campaign && campaign !== onboarding ? campaign : null);
    const ownerName = input.accountManager?.trim() ?? '';
    const owner = ownerName && ownerName.toLowerCase() !== 'unassigned' ? ownerName : null;
    const parts: string[] = [];
    const spec = input.deliverablesSpec?.trim() ?? '';
    if (spec) parts.push(spec);
    if (typeof input.seoHours === 'number' && Number.isFinite(input.seoHours) && input.seoHours > 0) {
        const hours = Math.round(input.seoHours * 100) / 100;
        const text = Number.isInteger(hours) ? String(hours) : String(hours);
        parts.push(`${text} SEO hours / month`);
    }
    return {
        startDate,
        startLabel: startDate ? formatCampaignDay(startDate) : null,
        owner,
        scope: parts.length > 0 ? parts.join(' · ') : null,
    };
}

export function identityFromClient(client: Pick<
    ClientProject,
    'launchDate' | 'launchDateOverride' | 'onboardingDate' | 'accountManager' | 'seoHours' | 'deliverables' | 'engagementModel' | 'campaignConfig'
>): CampaignIdentity {
    return campaignIdentity({
        launchDate: client.launchDate,
        launchDateOverride: client.launchDateOverride,
        onboardingDate: client.onboardingDate,
        campaignStart: client.engagementModel === 'Campaign' ? client.campaignConfig?.startDate : null,
        accountManager: client.accountManager,
        seoHours: client.seoHours,
        deliverablesSpec: client.deliverables,
    });
}
