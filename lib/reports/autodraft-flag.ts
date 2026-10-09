/**
 * Server switch for the business-day-3 draft cron.
 * Unset or any value other than `true` does not write reports.
 * Separate from NEXT_PUBLIC_SEARCH_REPORTING, which only gates the board UI.
 */
export function reportAutodraftEnabled(): boolean {
    return process.env.REPORT_AUTODRAFT_ENABLED === 'true';
}
