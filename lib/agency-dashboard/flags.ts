/**
 * Agency Dashboard (Search Console portfolio). Off unless both are set.
 *
 * `AGENCY_DASHBOARD` must be the exact string `true`.
 * `AGENCY_DASHBOARD_ORG_IDS` is a required comma-separated organization allowlist.
 * An unset, empty, or non-matching allowlist stays off, including when the
 * master switch is true. Start with the Sandbox org only.
 */

export const AGENCY_DASHBOARD_SANDBOX_ORG_ID = '06e536b9-beac-49bc-8c96-1df021102590';

export const AGENCY_DASHBOARD_HREF = '/agency';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function enabled(value: string | undefined): boolean {
    return value === 'true';
}

function orgAllowlist(raw: string | undefined): string[] {
    if (raw == null || raw.trim() === '') return [];
    return raw
        .split(',')
        .map(part => part.trim().toLowerCase())
        .filter(part => UUID.test(part));
}

export function agencyDashboardEnabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    if (!enabled(env.AGENCY_DASHBOARD)) return false;
    if (!organizationId) return false;
    return orgAllowlist(env.AGENCY_DASHBOARD_ORG_IDS).includes(organizationId.toLowerCase());
}

/** Hide the nav item until the flag is on for this organization. */
export function agencyDashboardNav<T extends { href: string }>(items: readonly T[], enabledForOrg: boolean): T[] {
    return items.filter(item => item.href !== AGENCY_DASHBOARD_HREF || enabledForOrg);
}
