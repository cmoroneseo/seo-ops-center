/** Cache-busting path. `team` is not authorization — the session cookie is. */

export function dashboardPortfolioPath(range: string, organizationId: string): string {
    const params = new URLSearchParams({ range, team: organizationId });
    return `/api/agency-dashboard?${params}`;
}

export function dashboardQueriesPath(range: string, organizationId: string, clientId: string): string {
    const params = new URLSearchParams({ range, team: organizationId, clientId });
    return `/api/agency-dashboard/queries?${params}`;
}

/** A team id that does not match the session must not be answered with the other organization's numbers. */
export function teamMatchesSession(team: string | null, organizationId: string): boolean {
    return team == null || team === '' || team === organizationId;
}
