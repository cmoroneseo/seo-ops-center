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

/** Ordered list of report sections, mapped to our 4 data sources. */
export const REPORT_SECTIONS: SectionDef[] = [
    { key: 'gsc', name: 'Organic Search', source: 'gsc', icon: '🔍', blurb: 'Search Console — clicks, impressions & rankings' },
    { key: 'ga4', name: 'Website Traffic', source: 'ga4', icon: '📊', blurb: 'Google Analytics — sessions, users & engagement' },
    { key: 'gbp', name: 'Local Presence', source: 'gbp', icon: '📍', blurb: 'Business Profile — calls, directions & reviews' },
    { key: 'ahrefs', name: 'Authority & Rankings', source: 'ahrefs', icon: '🔗', blurb: 'Ahrefs — domain rating & keyword positions' },
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
        { key: 'organic_clicks', label: 'Organic Clicks', format: 'number' },
        { key: 'impressions', label: 'Impressions', format: 'number' },
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
        { key: 'calls', label: 'Calls', format: 'number' },
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

/** Format a raw metric value for display. */
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

/** Month-over-month delta for a single metric. */
export function computeDelta(current: unknown, previous: unknown, lowerIsBetter = false): Delta | null {
    const cur = Number(current);
    const prev = Number(previous);
    if (isNaN(cur) || isNaN(prev) || prev === 0) return null;
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    const direction: Delta['direction'] = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
    const rising = direction === 'up';
    const isGood = direction === 'flat' ? true : lowerIsBetter ? !rising : rising;
    return { pct, direction, isGood };
}

/** 'YYYY-MM' → previous month 'YYYY-MM'. */
export function previousMonth(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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
