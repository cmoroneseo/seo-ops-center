import { PLAN_FILTER_QUERY_KEYS } from '../seo-plan/plan-filters';

/** Local Campaign tabs. Overview is the default; unknown values stay there. */
export type CampaignView = 'overview' | 'roadmap' | 'work' | 'results';

/**
 * Workspace query for this destination.
 * `tab=campaign` is already the SEO Plan, so Campaign cannot reuse it.
 */
export const CAMPAIGN_WORKSPACE_TAB = 'campaign-workspace';

/** SEO Plan routes. `tab=plan` is the older alias of `tab=campaign`. */
const SEO_PLAN_TABS = new Set(['campaign', 'plan']);

/**
 * Query the monthly board still reads after an SEO Plan URL moves under Campaign Work.
 * `planView` is not one of them: Work is the monthly board, not the old subviews.
 */
const SEO_PLAN_WORK_KEEP = ['overviewMonth', 'overviewTask', 'phase', ...PLAN_FILTER_QUERY_KEYS] as const;

export function parseCampaignView(value: string | null | undefined): CampaignView {
    if (value === 'roadmap' || value === 'work' || value === 'results') return value;
    return 'overview';
}

export function isSeoPlanWorkspaceTab(tab: string | null | undefined): boolean {
    return tab != null && SEO_PLAN_TABS.has(tab);
}

/**
 * When Campaign is on, an SEO Plan URL becomes Campaign Work.
 * The client id stays in the path. Month, task, and phase stay so the board opens the same place.
 * Returns null when Campaign is off, or when the URL is not an SEO Plan link.
 */
export function seoPlanWorkSearch(search: string, campaignWorkspace: boolean): string | null {
    if (!campaignWorkspace) return null;
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (!isSeoPlanWorkspaceTab(params.get('tab'))) return null;
    const next = new URLSearchParams();
    next.set('tab', CAMPAIGN_WORKSPACE_TAB);
    next.set('campaignView', 'work');
    for (const key of SEO_PLAN_WORK_KEEP) {
        const value = params.get(key);
        if (value) next.set(key, value);
    }
    return next.toString();
}
