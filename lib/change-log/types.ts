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
    title: 'Title',
    h1: 'H1',
    meta: 'Meta',
    content_refresh: 'Content refresh',
    internal_links: 'Internal links',
    schema: 'Schema',
    new_page: 'New page',
    redirect: 'Redirect',
    cro_block: 'CRO block',
    other: 'Other',
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
    clicks: 'Clicks',
    impressions: 'Impressions',
    ctr: 'CTR',
    avg_position: 'Avg. position',
    organic_sessions: 'Organic sessions',
    key_events: 'Key events',
};

export type Verdict = 'improved' | 'flat' | 'declined' | 'too_early';
export type ControlMode = 'untouched' | 'sitewide' | 'none';
export type BaselineStatus = 'captured' | 'partial' | 'missing';

export const VERDICT_LABEL: Record<Verdict, string> = {
    improved: 'Improved',
    flat: 'Flat',
    declined: 'Declined',
    too_early: 'Too early',
};

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
}

export interface Confounder {
    id: string;
    title: string;
    changeType: ChangeType;
    liveAt: string;
    liveOn: string;
    overlap: 'same_day' | 'baseline' | 'after';
}
