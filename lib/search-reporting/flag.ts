/**
 * Opt-in for Search Reporting surfaces: Search Insights v2, SEO Plan › Results,
 * the month-close board, and client report v2.
 *
 * Unset or any value other than `true` leaves those surfaces on today's behavior.
 * This is a different switch from `NEXT_PUBLIC_WORKSPACE_CANVAS` and
 * `NEXT_PUBLIC_WORKSPACE_OVERVIEW`.
 */
export function searchReportingEnabled(): boolean {
    return process.env.NEXT_PUBLIC_SEARCH_REPORTING === 'true';
}
