import { formatDelta, type FormattedDelta } from '@/lib/reporting/delta';
import type { BlockComparison, BlockReceipt, DistortedReason, SearchMetrics } from './types';

export const GSC_SOURCE = 'Google Search Console';

export const METHODS = {
    allGoogleSearch: 'Sum of stored daily property totals for final Pacific days. Preliminary days are excluded and listed on the mask. Labelled All Google Search.',
    organic: 'Sum of stored page rows with surface organic. Preliminary days are excluded. Page-level surface split from the rows already stored.',
    map: 'Sum of stored page rows with surface gbp_link. Preliminary days are excluded. Kept as its own map pack series.',
    pageOrganicGrain: 'Sum of stored page_organic rows for final days in the range. Page-level totals.',
    device: 'Stored device rows for the requested device. A device grain that was not collected for the range stays null.',
    queries: 'Query and page rows on final days, split by surface. Position bands are impression-weighted inside one surface.',
    cities: 'Query impressions on final days, clustered by city token. A city is shown only with at least 40 impressions in both windows.',
    movers: 'Query impression changes by surface on final days. A drop counts only after two consecutive checks. A prior sample that covers under half the window is mix shift and sorts last.',
    pages: 'Page rows on final days, split by surface. Business Profile links keep the landing path in the label.',
    ahrefs: 'Stored Ahrefs reference rows compared with the GSC organic position for the same query.',
    dfs: 'DataForSEO spot checks. No spot-check table is stored, so this slot stays empty.',
} as const;

export function receipt(input: {
    source: string;
    start: string;
    end: string;
    final: boolean;
    syncedAt: string | null;
    method: string;
}): BlockReceipt {
    return {
        source: input.source,
        range: `${input.start}/${input.end}`,
        final: input.final,
        synced_at: input.syncedAt,
        method: input.method,
    };
}

export function latestSync(importedAt: (string | null)[], fallback: string | null): string | null {
    let latest: string | null = null;
    for (const value of importedAt) {
        if (!value) continue;
        if (latest == null || value > latest) latest = value;
    }
    return latest ?? fallback;
}

export function metricDelta(
    current: SearchMetrics | null,
    prior: SearchMetrics | null,
    distorted: { reason: DistortedReason } | null,
    field: 'impressions' | 'position',
): FormattedDelta | null {
    if (!current && !distorted) return null;
    return formatDelta(
        current ? current[field] : null,
        prior ? prior[field] : null,
        {
            metric: field === 'position' ? 'position' : 'count',
            audience: 'staff',
            distorted: distorted ? { reason: distorted.reason } : null,
        },
    );
}

/** List sections carry the window reason without borrowing another series' totals. */
export function distortionComparison(distorted: { distorted: boolean; reason: DistortedReason | null }): BlockComparison {
    if (!distorted.distorted || !distorted.reason) {
        return { distorted: false, reason: null, impressions: null, position: null };
    }
    const struck = (metric: 'count' | 'position'): FormattedDelta => formatDelta(null, null, {
        metric,
        audience: 'staff',
        distorted: { reason: distorted.reason ?? undefined },
    });
    return {
        distorted: true,
        reason: distorted.reason,
        impressions: struck('count'),
        position: struck('position'),
    };
}

export function blockComparison(
    current: SearchMetrics | null,
    prior: SearchMetrics | null,
    distorted: { distorted: boolean; reason: DistortedReason | null },
): BlockComparison {
    const flag = distorted.distorted && distorted.reason ? { reason: distorted.reason } : null;
    return {
        distorted: distorted.distorted,
        reason: distorted.distorted ? distorted.reason : null,
        impressions: metricDelta(current, prior, flag, 'impressions'),
        position: metricDelta(current, prior, flag, 'position'),
    };
}
