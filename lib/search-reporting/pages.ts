import { sumMetrics } from './metrics';
import { BUSINESS_PROFILE_LABEL_PREFIX } from './types';
import type { PageRow, ReportingSurface } from './types';

export function pagePath(page: string): string {
    try {
        const url = new URL(page);
        return url.pathname || '/';
    } catch {
        const bare = page.split('?')[0] || '/';
        return bare.startsWith('/') ? bare : `/${bare}`;
    }
}

export function pageLabel(page: string, surface: ReportingSurface): string {
    const path = pagePath(page);
    if (surface === 'gbp_link') return `${BUSINESS_PROFILE_LABEL_PREFIX}${path}`;
    return path;
}

export interface PageFact {
    page: string;
    surface: ReportingSurface;
    clicks: number;
    impressions: number;
    position: number;
}

export function buildPageRows(facts: PageFact[], surface: 'all' | 'organic' | 'map'): PageRow[] {
    const groups = new Map<string, PageFact[]>();
    for (const fact of facts) {
        if (surface === 'organic' && fact.surface !== 'organic') continue;
        if (surface === 'map' && fact.surface !== 'gbp_link') continue;
        const key = `${fact.surface}\u0000${fact.page}`;
        const list = groups.get(key);
        if (list) list.push(fact);
        else groups.set(key, [fact]);
    }
    const rows: PageRow[] = [];
    for (const group of groups.values()) {
        const metrics = sumMetrics(group);
        const sample = group[0];
        rows.push({
            page: sample.page,
            path: pagePath(sample.page),
            surface: sample.surface,
            label: pageLabel(sample.page, sample.surface),
            clicks: metrics.clicks,
            impressions: metrics.impressions,
            position: metrics.position,
            ctr: metrics.ctr,
        });
    }
    rows.sort((a, b) => b.impressions - a.impressions || a.label.localeCompare(b.label));
    return rows;
}
