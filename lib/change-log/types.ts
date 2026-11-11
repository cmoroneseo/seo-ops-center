import type { CheckpointDays } from './thresholds';

export const CHANGE_TYPES = [
    'title',
    'h1',
    'meta',
    'content_refresh',
    'internal_links',
    'schema',
    'new_page',
    'redirect',
    'cro_block',
    'other',
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
    title: 'Search result title',
    h1: 'Main page heading',
    meta: 'Search result description',
    content_refresh: 'Content update',
    internal_links: 'Links between pages',
    schema: 'Search-friendly page data',
    new_page: 'New page',
    redirect: 'Redirect (old address sends visitors to a new one)',
    cro_block: 'Call-to-action section',
    other: 'Other',
};

/** Technical name, shown once in grey beside the plain label. */
export const CHANGE_TYPE_HINT: Partial<Record<ChangeType, string>> = {
    h1: 'H1',
    meta: 'Meta',
    schema: 'Schema',
    cro_block: 'CRO',
};

export const KPIS = [
    'clicks',
    'impressions',
    'ctr',
    'avg_position',
    'organic_sessions',
    'key_events',
] as const;

export type Kpi = (typeof KPIS)[number];

export const KPI_LABEL: Record<Kpi, string> = {
    clicks: 'Clicks from Google',
    impressions: 'Times shown in Google',
    ctr: 'Click rate',
    avg_position: 'Average Google position',
    organic_sessions: 'Visits from search',
    key_events: 'Leads and key actions',
};

/** Technical name, shown once in grey beside the plain label. */
export const KPI_HINT: Partial<Record<Kpi, string>> = {
    ctr: 'CTR',
};

/** Chart title. The metric name already says where the numbers come from. */
export function chartHeading(kpi: Kpi): string {
    const metric = KPI_LABEL[kpi];
    if (kpi === 'ctr') return `${metric} from Google, day by day`;
    return `${metric}, day by day`;
}

export type Verdict = 'improved' | 'flat' | 'declined' | 'too_early';
export type ControlMode = 'untouched' | 'sitewide' | 'none';
export type BaselineStatus = 'captured' | 'partial' | 'missing';

export const VERDICT_LABEL: Record<Verdict, string> = {
    improved: 'Improved',
    flat: 'No clear change',
    declined: 'Declined',
    too_early: 'Too early to tell',
};

export const EARLY_ESTIMATE_LABEL = 'Early estimate';

/** One result name. An estimate replaces the verdict word instead of appending it. */
export function resultLabel(verdict: Verdict, estimate: boolean): string {
    return estimate ? EARLY_ESTIMATE_LABEL : VERDICT_LABEL[verdict];
}

export const SEARCH_CONSOLE_HINT = "Google's report on how your site shows up in search.";

export interface ChangePage {
    url: string;
    urlKey: string;
    label: string;
    cmsPageId: string | null;
    cmsWidgetId: string | null;
}

export interface ChangeQuery {
    query: string;
    normalized: string;
}

export interface SeoChange {
    id: string;
    clientId: string;
    changeType: ChangeType;
    title: string;
    beforeText: string;
    afterText: string;
    liveAt: string;
    liveOn: string;
    approvedByName: string;
    approvedAt: string | null;
    backupReference: string;
    revertInstructions: string;
    kpi: Kpi;
    compareLastYear: boolean;
    pages: ChangePage[];
    queries: ChangeQuery[];
}

/** One Pacific day. Missing days are omitted, never stored as zero. */
export interface DayPoint {
    date: string;
    clicks: number;
    impressions: number;
    position: number;
    organicSessions: number | null;
    keyEvents: number | null;
    preliminary?: boolean;
}

export interface MetricRead {
    measured: boolean;
    clicks: number;
    impressions: number;
    ctr: number | null;
    position: number | null;
    organicSessions: number | null;
    keyEvents: number | null;
    daysPresent: number;
    daysExpected: number;
}

export interface RateDelta {
    /** Positive means the helpful direction. Null when the base is 0. */
    helpful: number | null;
    /** After minus before, in the metric's own unit. Position: negative means the rank number fell. */
    absolute: number | null;
    before: number | null;
    after: number | null;
    fromZero: boolean;
}

export interface CheckpointRead {
    days: CheckpointDays;
    ready: boolean;
    estimate: boolean;
    lowData: boolean;
    verdict: Verdict;
    note: string;
    page: MetricRead;
    control: MetricRead | null;
    controlMode: ControlMode;
    controlUnreliable: boolean;
    pageMove: RateDelta;
    controlMove: RateDelta | null;
    lift: number | null;
}

export interface QueryCompare {
    query: string;
    beforeClicks: number;
    afterClicks: number;
    beforeImpressions: number;
    afterImpressions: number;
    beforePosition: number | null;
    afterPosition: number | null;
    beforeCtr: number | null;
    afterCtr: number | null;
    clicksDelta: number;
    impressionsDelta: number;
    positionDelta: number | null;
}

export interface ChartPoint {
    date: string;
    page: number | null;
    control: number | null;
    live: boolean;
    preliminary: boolean;
}

export interface ImpactModel {
    kpi: Kpi;
    liveOn: string;
    finalThrough: string;
    lagDays: number;
    baseline: MetricRead;
    baselineReady: boolean;
    yoy: MetricRead | null;
    yoyNote: string | null;
    headline: CheckpointRead;
    checkpoints: CheckpointRead[];
    series: ChartPoint[];
    queries: QueryCompare[];
    gscConnected: boolean;
    ga4Connected: boolean;
    causation: string;
    controlLabel: string;
    sources: string[];
}

export interface TimelineItem {
    id: string;
    title: string;
    changeType: ChangeType;
    liveAt: string;
    liveOn: string;
    pageLabel: string;
    url: string;
    verdict: Verdict;
    estimate: boolean;
    deltaText: string;
    kpi: Kpi;
    checkpointDays: CheckpointDays | null;
    /** Finished check the latest result came from. Null when no check is finished. */
    headlineDays: CheckpointDays | null;
    /** Percentage points versus pages we didn't change. Null when it isn't ready — never a stand-in zero. */
    headlinePct: number | null;
    /** Date the next check is due. Null when every check is already final. */
    nextCheckOn: string | null;
    nextCheckDays: CheckpointDays | null;
}

export interface Confounder {
    id: string;
    title: string;
    changeType: ChangeType;
    liveAt: string;
    liveOn: string;
    overlap: 'same_day' | 'baseline' | 'after';
}
