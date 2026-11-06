/**
 * Opt-in for the client Rankings tab. The tracked-keywords report block
 * will use the same switch later.
 *
 * Unset or any value other than `true` hides the tab.
 * This is a different switch from `NEXT_PUBLIC_SEARCH_REPORTING`.
 */
export function keywordTrackingEnabled(): boolean {
    return process.env.NEXT_PUBLIC_KEYWORD_TRACKING === 'true';
}
