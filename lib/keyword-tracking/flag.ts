/**
 * Opt-in for the client Rankings tab and the tracked-keywords report block.
 *
 * Unset or any value other than `true` hides the tab.
 * This is a different switch from `NEXT_PUBLIC_SEARCH_REPORTING`.
 */
export function keywordTrackingEnabled(): boolean {
    return process.env.NEXT_PUBLIC_KEYWORD_TRACKING === 'true';
}
