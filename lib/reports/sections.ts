// Shared report section + metric definitions.
// Single source of truth for the builder UI, auto-fill logic, and PDF/print output.

export type ReportSourceKey = 'gsc' | 'ga4' | 'gbp' | 'ahrefs';

export interface SectionDef {
    key: ReportSourceKey;
    name: string;          // Human-facing section title
    source: ReportSourceKey; // metrics.source value
    icon: string;
    blurb: string;         // Short description shown under the title
}

/** Ordered list of report sections. Ahrefs stays last: it is the appendix. */
export const REPORT_SECTIONS: SectionDef[] = [
    { key: 'gsc', name: 'Organic Search', source: 'gsc', icon: '🔍', blurb: 'Search Console — clicks, times shown, and average position' },
    { key: 'ga4', name: 'Website Traffic', source: 'ga4', icon: '📊', blurb: 'Google Analytics — sessions, users, and engagement' },
    { key: 'gbp', name: 'Google Business Profile', source: 'gbp', icon: '📍', blurb: 'Business Profile — call-button taps, directions, and website clicks' },
    { key: 'ahrefs', name: 'Authority (Ahrefs, appendix)', source: 'ahrefs', icon: '🔗', blurb: 'Ahrefs appendix — domain rating' },
];

export interface MetricDef {
    key: string;
    label: string;
    format: 'number' | 'decimal' | 'percent';
    lowerIsBetter?: boolean; // e.g. bounce rate, avg position
}

/** Per-source metric definitions, in display order. */
export const METRIC_DEFS: Record<ReportSourceKey, MetricDef[]> = {
    gsc: [
        { key: 'organic_clicks', label: 'Clicks to your website from Google', format: 'number' },
        { key: 'impressions', label: 'Times shown', format: 'number' },
        { key: 'avg_position', label: 'Avg Position', format: 'decimal', lowerIsBetter: true },
        { key: 'ctr', label: 'CTR', format: 'percent' },
    ],
    ga4: [
        { key: 'sessions', label: 'Sessions', format: 'number' },
        { key: 'new_users', label: 'New Users', format: 'number' },
        { key: 'organic_sessions', label: 'Organic Sessions', format: 'number' },
        { key: 'bounce_rate', label: 'Bounce Rate', format: 'percent', lowerIsBetter: true },
    ],
    gbp: [
        { key: 'impressions', label: 'Impressions', format: 'number' },
        { key: 'calls', label: 'Call-button taps', format: 'number' },
        { key: 'direction_requests', label: 'Directions', format: 'number' },
        { key: 'website_clicks', label: 'Website Clicks', format: 'number' },
        { key: 'review_count', label: 'Reviews', format: 'number' },
        { key: 'avg_rating', label: 'Avg Rating', format: 'decimal' },
    ],
    ahrefs: [
        { key: 'domain_rating', label: 'Domain Rating', format: 'number' },
        { key: 'ranked_keywords', label: 'Ranked Keywords', format: 'number' },
        { key: 'top_10_keywords', label: 'Top 10', format: 'number' },
        { key: 'top_20_keywords', label: 'Top 20', format: 'number' },
        { key: 'top_50_keywords', label: 'Top 50', format: 'number' },
    ],
};

/** Ahrefs estimates that are not measured counts. Never shown on a client report. */
const MODELED_METRIC_KEYS = new Set([
    'traffic',
    'org_traffic',
    'organic_traffic',
    'paid_traffic',
    'traffic_value',
    'keyword_difficulty',
    'volume',
]);

export function isModeledMetricKey(key: string): boolean {
    return MODELED_METRIC_KEYS.has(key);
}

export function clientSafeMetricData(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!data) return {};
    return Object.fromEntries(Object.entries(data).filter(([key]) => !isModeledMetricKey(key)));
}

const SOURCE_CAPTION: Record<ReportSourceKey, string> = {
    gsc: 'Google Search Console',
    ga4: 'Google Analytics',
    gbp: 'Google Business Profile',
    ahrefs: 'Ahrefs',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function lastDayOfMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "Google Search Console · Sep 1–30, 2026 · as of Oct 2, 2026". */
export function formatMetricCaption(source: ReportSourceKey, month: string, updatedAt?: string | null): string {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText);
    const last = lastDayOfMonth(year, monthIndex);
    const range = `${MONTHS[monthIndex - 1]} 1–${last}, ${year}`;
    const name = SOURCE_CAPTION[source];
    if (!updatedAt) return `${name} · ${range}`;
    const asOf = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(updatedAt));
    return `${name} · ${range} · as of ${asOf}`;
}

/** Format a raw metric value for display. Missing values stay an em dash, never 0. */
export function formatMetric(value: unknown, format: MetricDef['format']): string {
    if (value == null || value === '' || (typeof value === 'number' && isNaN(value))) return '—';
    const num = Number(value);
    if (isNaN(num)) return String(value);
    switch (format) {
        case 'percent':
            // stored 0–1 → show as %
            return `${(num * 100).toFixed(1)}%`;
        case 'decimal':
            return num.toFixed(1);
        default:
            return num.toLocaleString();
    }
}

export interface Delta {
    pct: number;        // signed percent change
    direction: 'up' | 'down' | 'flat';
    isGood: boolean;    // good given lowerIsBetter
}

function missingMetric(value: unknown): boolean {
    if (value == null || value === '') return true;
    if (typeof value === 'number') return !Number.isFinite(value);
    if (typeof value === 'string' && !Number.isFinite(Number(value))) return true;
    return false;
}

/** Month-over-month delta for a single metric. Missing values stay missing. */
export function computeDelta(current: unknown, previous: unknown, lowerIsBetter = false): Delta | null {
    if (missingMetric(current) || missingMetric(previous)) return null;
    const cur = Number(current);
    const prev = Number(previous);
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    const direction: Delta['direction'] = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
    const rising = direction === 'up';
    const isGood = direction === 'flat' ? true : lowerIsBetter ? !rising : rising;
    return { pct, direction, isGood };
}

export { previousMonth } from '@/lib/sync/months';

/** 'YYYY-MM' → 'June 2026'. */
export function monthLabel(month: string): string {
    return new Date(month + '-15').toLocaleString('default', { month: 'long', year: 'numeric' });
}

export interface SectionConfig {
    key: ReportSourceKey;
    enabled: boolean;
    order: number;
}

/** Default section config — all on, in canonical order. */
export function defaultSectionConfig(): SectionConfig[] {
    return REPORT_SECTIONS.map((s, i) => ({ key: s.key, enabled: true, order: i }));
}
