import type { GscDevice, GscGrain, GscSurface } from '@/lib/gsc/history';
import type { MonthFinality } from '@/lib/gsc/monthly';
import type { FormattedDelta } from '@/lib/reporting/delta';
import type { FreshnessReadout } from '@/lib/reporting/freshness';

export const CLUSTER_IMPRESSION_MINIMUM = 40;
export const ALL_GOOGLE_SEARCH_LABEL = 'All Google Search';
export const ORGANIC_LABEL = 'Organic';
export const MAP_LABEL = 'Map pack';
export const NOT_COLLECTED_REASON = 'Partial';
export const NOT_COLLECTED_DETAIL = 'not collected yet';
export const TOO_FEW_SEARCHES = 'too few searches';
export const BUSINESS_PROFILE_LABEL_PREFIX = 'Business Profile link → ';

export const DISTORTED_REASONS = [
    'unequal coverage',
    'partial period',
    'history starts mid-period',
    'mix shift',
] as const;

export type DistortedReason = (typeof DISTORTED_REASONS)[number];
export type SurfaceFilter = 'all' | 'organic' | 'map';
export type ReportingSurface = 'organic' | 'gbp_link';

export interface StoredDay {
    id: string;
    date: string;
    isIncomplete: boolean;
    importedAt: string | null;
    pageLimited: boolean;
    queryLimited: boolean;
}

export interface StoredFact {
    dayId: string;
    grain: GscGrain;
    page: string;
    query: string;
    clicks: number;
    impressions: number;
    position: number;
    device: string | null;
    country: string | null;
    surface: GscSurface;
}

export interface SearchMetrics {
    clicks: number;
    impressions: number;
    ctr: number | null;
    position: number | null;
}

export interface LabelledMetrics extends SearchMetrics {
    label: string;
}

export interface BlockReceipt {
    source: string;
    range: string;
    final: boolean;
    synced_at: string | null;
    method: string;
}

export interface BlockComparison {
    distorted: boolean;
    reason: DistortedReason | null;
    impressions: FormattedDelta | null;
    position: FormattedDelta | null;
}

export interface GrainSlot {
    available: boolean;
    value: SearchMetrics | null;
    state: 'partial' | 'empty' | 'fresh' | 'missing';
    reason: string | null;
    detail: string | null;
}

export interface DayPoint {
    date: string;
    clicks: number | null;
    impressions: number | null;
    position: number | null;
    preliminary: boolean;
    missing: boolean;
}

export interface SummaryBlock {
    series: { organic: DayPoint[] | null; map: DayPoint[] | null };
    mask: { date: string; reason: 'preliminary' | 'missing' }[];
    totals: {
        organic: LabelledMetrics | null;
        map: LabelledMetrics | null;
        allGoogleSearch: LabelledMetrics | null;
    };
    receipt: BlockReceipt;
    comparison: BlockComparison;
    seriesComparisons: {
        organic: BlockComparison | null;
        map: BlockComparison | null;
        allGoogleSearch: BlockComparison | null;
    };
}

export interface PositionBand {
    id: string;
    label: string;
    queries: number;
    impressions: number;
    clicks: number;
}

export interface InvestigationRow {
    query?: string;
    page?: string;
    clicks: number;
    impressions: number;
    position: number;
    observedDays: number;
    pages?: { page: string; clicks: number; impressions: number; position: number }[];
}

export interface SurfaceInvestigations {
    nearPageOne: InvestigationRow[];
    deeperVisibility: InvestigationRow[];
    pageVisibility: InvestigationRow[];
    overlappingUrls: InvestigationRow[];
}

export interface QueriesBlock {
    bands: { organic: PositionBand[] | null; map: PositionBand[] | null };
    investigations: { organic: SurfaceInvestigations | null; map: SurfaceInvestigations | null };
    receipt: BlockReceipt;
    comparison: BlockComparison;
}

export interface CityRow {
    city: string;
    surface: ReportingSurface;
    shown: boolean;
    impressions: number | null;
    priorImpressions: number | null;
    display: string;
    reason: string | null;
}

export interface CitiesBlock {
    minimum: number;
    tokens: string[];
    rows: CityRow[];
    receipt: BlockReceipt;
    comparison: BlockComparison;
}

export interface MoverRow {
    query: string;
    surface: ReportingSurface;
    impressions: number;
    priorImpressions: number;
    earlierImpressions: number | null;
    kind: 'rise' | 'drop' | 'pending' | 'mix_shift';
    /** True only after the current window and the prior window both dropped. */
    drop: boolean;
    tag: 'mix_shift' | null;
    reason: DistortedReason | null;
}

export interface MoversBlock {
    minimum: number;
    rows: MoverRow[];
    receipt: BlockReceipt;
    comparison: BlockComparison;
}

export interface PageRow {
    page: string;
    path: string;
    surface: ReportingSurface;
    label: string;
    clicks: number;
    impressions: number;
    position: number | null;
    ctr: number | null;
}

export interface PagesBlock {
    rows: PageRow[];
    receipt: BlockReceipt;
    comparison: BlockComparison;
}

export interface TrackerPair {
    query: string;
    tracker: 'ahrefs' | 'dataforseo';
    trackerPosition: number | null;
    gscOrganicPosition: number | null;
    anomalyOpen: boolean;
}

export interface TrackerCheckBlock {
    audience: 'staff';
    anomaly_open: boolean;
    ahrefs: {
        source: 'Ahrefs';
        tag: 'ref';
        rows: TrackerPair[];
        note: string | null;
        receipt: BlockReceipt;
    };
    dfs: {
        audience: 'staff';
        source: 'DataForSEO';
        tag: 'snapshot';
        available: false;
        rows: TrackerPair[];
        value: null;
        state: 'partial';
        reason: string;
        detail: string;
        receipt: BlockReceipt;
    };
}

export interface SearchReportingResponse {
    view: 'v2';
    connected: boolean;
    property: string | null;
    surface: SurfaceFilter;
    state: FreshnessReadout['state'];
    freshness: FreshnessReadout;
    range: {
        preset: '28d' | 'month';
        key: string;
        start: string;
        end: string;
        timezone: 'America/Los_Angeles';
        finality: MonthFinality;
        prior: { start: string; end: string };
        earlier: { start: string; end: string };
    } | null;
    grains: {
        pageOrganic: GrainSlot;
        device: GrainSlot & { requested: GscDevice | null };
    } | null;
    summary: SummaryBlock | null;
    queries: QueriesBlock | null;
    cities: CitiesBlock | null;
    movers: MoversBlock | null;
    pages: PagesBlock | null;
    tracker: TrackerCheckBlock | null;
}

export interface AhrefsReferenceRow {
    query: string;
    position: number | null;
}
