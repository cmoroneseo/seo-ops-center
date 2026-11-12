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

/** single is one change. group is the same treatment on many URLs, over time. Not a split. */
export const TEST_KINDS = ['single', 'group'] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const TREATMENTS = ['title_meta', 'title', 'meta', 'h1', 'other'] as const;
export type Treatment = (typeof TREATMENTS)[number];

export const TREATMENT_LABEL: Record<Treatment, string> = {
    title_meta: 'Title and meta description format',
    title: 'Title tag',
    meta: 'Meta description',
    h1: 'H1',
    other: 'Other',
};

/** Starting change type when someone picks a treatment. The form can still change it. */
export const TREATMENT_CHANGE_TYPE: Record<Treatment, ChangeType> = {
    title_meta: 'other',
    title: 'title',
    meta: 'meta',
    h1: 'h1',
    other: 'other',
};

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
    /** Defaults to a single change. Group is many URLs with one went-live date. */
    testKind: TestKind;
    /** Empty on a single change. A group test stores the template slug. */
    treatment: Treatment | '';
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
    /** Rest-of-site clicks for this check. Null when the site wasn't measured. Not a stand-in zero. */
    restOfSite: MetricRead | null;
    /** Sitewide totals for this check. Null when the site wasn't measured. Not the untouched remainder. */
    sitewide: MetricRead | null;
}

export interface QueryCompare {
    query: string;
    /** Null when that side was not measured. A measured zero stays 0. */
    beforeClicks: number | null;
    afterClicks: number | null;
    beforeImpressions: number | null;
    afterImpressions: number | null;
    beforePosition: number | null;
    afterPosition: number | null;
    beforeCtr: number | null;
    afterCtr: number | null;
    clicksDelta: number | null;
    impressionsDelta: number | null;
    positionDelta: number | null;
}

export interface ChartPoint {
    date: string;
    /** Watched metric for this day. Null when the day was not measured. */
    page: number | null;
    control: number | null;
    live: boolean;
    preliminary: boolean;
    /**
     * Real daily counts for the changed page.
     * Null means that day was not measured. Zero is a real zero.
     * Click rate and position stay null when the page was not shown.
     */
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    position: number | null;
    controlClicks: number | null;
    controlImpressions: number | null;
    controlCtr: number | null;
    controlPosition: number | null;
}

/** Change percent for one URL in a group test. Null means that side was not measured. */
export interface PageImpactRow {
    url: string;
    label: string;
    clicksChange: number | null;
    impressionsChange: number | null;
    positionChange: number | null;
    ctrChange: number | null;
}

export interface ImpactModel {
    kpi: Kpi;
    liveOn: string;
    finalThrough: string;
    lagDays: number;
    baseline: MetricRead;
    /**
     * Rest-of-site clicks over the 28 days before go-live.
     * Null when the site wasn't measured. Never a stand-in zero.
     */
    baselineControl: MetricRead | null;
    /**
     * Sitewide clicks and the other metrics over the 28 days before go-live.
     * Null when the site wasn't measured. Not the untouched remainder.
     */
    baselineSite: MetricRead | null;
    baselineReady: boolean;
    yoy: MetricRead | null;
    yoyNote: string | null;
    headline: CheckpointRead;
    checkpoints: CheckpointRead[];
    series: ChartPoint[];
    queries: QueryCompare[];
    /** Empty for a single change. One row per URL for a group test. */
    pageRows: PageImpactRow[];
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
    /** Logged URLs. A group test uses this for the "3 pages" line. */
    pageCount?: number;
    /** Share of the current test window that has final Search Console data. */
    progressPercent?: number | null;
    progressStatus?: 'in_progress' | 'finished' | null;
    progressDays?: CheckpointDays | null;
}

export interface Confounder {
    id: string;
    title: string;
    changeType: ChangeType;
    liveAt: string;
    liveOn: string;
    overlap: 'same_day' | 'baseline' | 'after';
}
