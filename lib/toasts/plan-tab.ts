/**
 * The SEO Plan tab is the campaign view.
 * Tasks and Results under the same route are different screens, so they keep toasts.
 */
export function seoPlanTabHidesToasts(input: {
    activeTab: string;
    planView: string;
    stageListOn: boolean;
}): boolean {
    return input.activeTab === 'campaign' && (input.stageListOn || input.planView === 'plan');
}
