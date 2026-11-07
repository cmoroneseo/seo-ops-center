/**
 * Opt-in for the Campaign destination on the selected client.
 *
 * Unset or any value other than `true` hides the sidebar item and the view.
 * This is a different switch from `NEXT_PUBLIC_KEYWORD_TRACKING`.
 */
export function campaignWorkspaceEnabled(): boolean {
    return process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE === 'true';
}
