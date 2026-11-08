/**
 * The monthly execution board hides toasts.
 * That board is the SEO Plan tab, and Campaign Work when Campaign is on.
 * Tasks and Results under the old route are different screens, so they keep toasts.
 */
export function seoPlanTabHidesToasts(input: {
    activeTab: string;
    planView: string;
    stageListOn: boolean;
    campaignView?: string;
}): boolean {
    if (input.activeTab === 'campaign-workspace' && input.campaignView === 'work') return true;
    return input.activeTab === 'campaign' && (input.stageListOn || input.planView === 'plan');
}
