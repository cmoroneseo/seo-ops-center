import { assertClientCopy } from './copy-rules';
import { formatDelta } from './delta';
import { METRIC_DEFS, formatMetric, ReportSourceKey, type MetricDef } from './sections';

type MetricMap = Partial<Record<ReportSourceKey, Record<string, any>>>;

const HEADLINES: { source: ReportSourceKey; key: string }[] = [
    { source: 'gsc', key: 'organic_clicks' },
    { source: 'gsc', key: 'impressions' },
    { source: 'ga4', key: 'sessions' },
    { source: 'ga4', key: 'bounce_rate' },
    { source: 'gbp', key: 'impressions' },
    { source: 'gbp', key: 'calls' },
    { source: 'ahrefs', key: 'domain_rating' },
    { source: 'ahrefs', key: 'top_10_keywords' },
];

function missing(value: unknown): boolean {
    if (value == null || value === '') return true;
    return typeof value === 'number' ? !Number.isFinite(value) : !Number.isFinite(Number(value));
}

function factLine(def: MetricDef, current: unknown, previous: unknown): string | null {
    if (missing(current)) return null;
    const shown = formatMetric(current, def.format);
    const delta = formatDelta(current, previous, {
        lowerIsBetter: def.lowerIsBetter,
        scale: def.format === 'percent' ? 100 : 1,
    });
    if (delta.kind === 'no_baseline') return `${def.label}: ${shown}. No comparable baseline.`;
    if (delta.kind === 'noise') {
        return missing(previous)
            ? `${def.label}: ${shown}.`
            : `${def.label}: ${shown}, about the same as ${formatMetric(previous, def.format)}.`;
    }
    if (delta.kind === 'change' && delta.direction && delta.absolute != null) {
        const word = delta.direction === 'up' ? 'higher' : 'lower';
        const amount = def.format === 'percent' ? `${formatAbs(delta.absolute)} points` : formatAbs(delta.absolute);
        const pct = delta.percent == null ? '' : ` (${Math.abs(delta.percent).toFixed(1)}%)`;
        return `${def.label}: ${shown}, ${word} by ${amount}${pct} from ${formatMetric(previous, def.format)}.`;
    }
    return `${def.label}: ${shown}.`;
}

function formatAbs(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Plain-English draft from this month's metrics versus the prior month.
 * Facts only: no canned recommendations and no momentum framing.
 */
export function generateAutoSummary(
    clientName: string,
    monthLabel: string,
    current: MetricMap,
    previous: MetricMap,
): { executiveSummary: string; recommendations: string } {
    const facts: string[] = [];
    for (const headline of HEADLINES) {
        const def = METRIC_DEFS[headline.source].find(metric => metric.key === headline.key);
        const row = current[headline.source];
        if (!def || !row || !(headline.key in row)) continue;
        const line = factLine(def, row[headline.key], previous[headline.source]?.[headline.key]);
        if (line) facts.push(line);
    }

    const opener = `Search performance for ${clientName} in ${monthLabel}.`;
    const executiveSummary = facts.length > 0
        ? `${opener} ${facts.join(' ')}`
        : `${opener} No metrics are on file for this month.`;
    const recommendations = '';

    const sources = Object.keys(current);
    if (current.gsc) sources.push('gsc', 'organic_clicks', 'impressions');
    if (current.gbp && current.gbp.calls != null) sources.push('CALL_CLICKS');
    assertClientCopy(executiveSummary, sources);
    assertClientCopy(recommendations, sources);

    return { executiveSummary, recommendations };
}
