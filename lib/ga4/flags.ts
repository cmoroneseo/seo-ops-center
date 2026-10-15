/**
 * GA4 history. Off unless the flag is the exact string `true` and the
 * organization is on `GA4_ORG_IDS`. An empty allowlist stays off, including
 * when the master switch is true. Sandbox is the first org to allowlist.
 */

export const GA4_HISTORY_SANDBOX_ORG_ID = '06e536b9-beac-49bc-8c96-1df021102590';

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

export function ga4HistoryEnabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    if (!enabled(env.GA4_HISTORY_ENABLED)) return false;
    if (!organizationId) return false;
    return orgAllowlist(env.GA4_ORG_IDS).includes(organizationId.toLowerCase());
}

/** Backfill also requires the history flag. Both default off. */
export function ga4BackfillEnabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    if (!enabled(env.GA4_BACKFILL_ENABLED)) return false;
    return ga4HistoryEnabled(env, organizationId);
}

/** Organization ids allowed to sync. Empty unless the history flag is exactly `true`. */
export function ga4OrgAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
    if (!enabled(env.GA4_HISTORY_ENABLED)) return [];
    return orgAllowlist(env.GA4_ORG_IDS);
}
