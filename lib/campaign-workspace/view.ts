/** Local Campaign tabs. Overview is the default; unknown values stay there. */
export type CampaignView = 'overview' | 'roadmap' | 'results';

/**
 * Workspace query for this destination.
 * `tab=campaign` is already the SEO Plan, so Campaign cannot reuse it.
 */
export const CAMPAIGN_WORKSPACE_TAB = 'campaign-workspace';

export function parseCampaignView(value: string | null | undefined): CampaignView {
    if (value === 'roadmap' || value === 'results') return value;
    return 'overview';
}
