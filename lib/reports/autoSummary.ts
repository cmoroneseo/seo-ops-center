import { METRIC_DEFS, computeDelta, ReportSourceKey } from './sections';

type MetricMap = Partial<Record<ReportSourceKey, Record<string, any>>>;

/**
 * Build a plain-English executive summary + recommendations draft from the
 * month's metrics vs. the prior month. Deterministic (no LLM) so it works
 * offline; AMs edit afterward. Designed to read like the Search Atlas
 * "AI Insights" block.
 */
export function generateAutoSummary(
    clientName: string,
    monthLabel: string,
    current: MetricMap,
    previous: MetricMap,
): { executiveSummary: string; recommendations: string } {
    const wins: string[] = [];
    const watch: string[] = [];

    const note = (label: string, cur: any, prev: any, lowerIsBetter = false) => {
        const d = computeDelta(cur, prev, lowerIsBetter);
        if (!d || d.direction === 'flat') return;
        const verb = d.direction === 'up' ? 'rose' : 'fell';
        const phrase = `${label} ${verb} ${Math.abs(d.pct).toFixed(0)}%`;
        (d.isGood ? wins : watch).push(phrase);
    };

    // Highlight the headline metric per source.
    if (current.gsc) note('organic clicks', current.gsc.organic_clicks, previous.gsc?.organic_clicks);
    if (current.ga4) note('website sessions', current.ga4.sessions, previous.ga4?.sessions);
    if (current.ga4) note('bounce rate', current.ga4.bounce_rate, previous.ga4?.bounce_rate, true);
    if (current.gbp) note('local impressions', current.gbp.impressions, previous.gbp?.impressions);
    if (current.gbp) note('calls', current.gbp.calls, previous.gbp?.calls);
    if (current.ahrefs) note('domain rating', current.ahrefs.domain_rating, previous.ahrefs?.domain_rating);
    if (current.ahrefs) note('top-10 keywords', current.ahrefs.top_10_keywords, previous.ahrefs?.top_10_keywords);

    const sourcesPresent = Object.keys(current).length;

    let executiveSummary: string;
    if (sourcesPresent === 0) {
        executiveSummary = `This report covers ${clientName}'s SEO performance for ${monthLabel}. Connect data sources or enter metrics manually to populate performance highlights.`;
    } else {
        const winText = wins.length
            ? `Key gains this period: ${listJoin(wins.slice(0, 4))}.`
            : '';
        const watchText = watch.length
            ? ` Areas to watch: ${listJoin(watch.slice(0, 3))}.`
            : '';
        const opener = wins.length >= watch.length
            ? `${clientName} saw positive momentum across its SEO program in ${monthLabel}.`
            : `${clientName}'s SEO program showed mixed results in ${monthLabel}.`;
        executiveSummary = `${opener} ${winText}${watchText}`.trim();
    }

    // Recommendations draft from the watch items + standard playbook.
    const recs: string[] = [];
    if (watch.some(w => w.includes('bounce'))) recs.push('Improve landing-page relevance and load speed to reduce bounce rate.');
    if (watch.some(w => w.includes('clicks') || w.includes('sessions'))) recs.push('Refresh underperforming pages and expand content targeting high-intent queries.');
    if (current.ahrefs) recs.push('Continue building authority links to move striking-distance keywords (positions 11–20) into the top 10.');
    if (current.gbp) recs.push('Maintain Google Business Profile activity — posts, photos, and review responses — to grow local visibility.');
    if (recs.length === 0) recs.push('Sustain current strategy and monitor month-over-month trends to capture additional traffic.');

    const recommendations = recs.map((r, i) => `${i + 1}. ${r}`).join('\n');

    return { executiveSummary, recommendations };
}

function listJoin(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
