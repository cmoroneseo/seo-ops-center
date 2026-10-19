/** Display formatting for client hour fields. Null and non-finite values stay an em dash. */

export function formatHourAmount(value: number): string {
    if (!Number.isFinite(value)) return '—';
    return String(Math.round(value * 100) / 100);
}

/** Logged hours against one quota. A null quota reads "X / —". A missing logged total reads "—". */
export function formatHoursAgainstQuota(logged: number | null | undefined, budget: number | null | undefined): string {
    if (logged == null || !Number.isFinite(logged)) return '—';
    if (budget == null || !Number.isFinite(budget)) return `${formatHourAmount(logged)} / —`;
    return `${formatHourAmount(logged)} / ${formatHourAmount(budget)}h`;
}

/** Monthly retainer hours, or the custom-scope label already stored on the client. */
export function clientScopeLabel(client: { setupScope?: { mode?: string } | null; seoHours: number }): string {
    if (client.setupScope?.mode === 'custom') return 'Custom scope';
    return `${formatHourAmount(client.seoHours)}h/mo`;
}
