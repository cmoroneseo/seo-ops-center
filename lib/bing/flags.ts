/**
 * Bing Webmaster. Off unless both are set.
 *
 * `BING_WEBMASTER` must be the exact string `true`.
 * `BING_WEBMASTER_ORG_IDS` is a required comma-separated organization allowlist.
 * An unset, empty, or non-matching allowlist stays off, including when the
 * master switch is true. Sandbox is the first org to allowlist. The production
 * org stays off until that later rollout step.
 */

export const BING_WEBMASTER_SANDBOX_ORG_ID = '06e536b9-beac-49bc-8c96-1df021102590';

export const BING_WEBMASTER_MEG_ORG_ID = '51f63cc5-4c52-45ed-bb20-2d5ce6320bf2';

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

export function bingWebmasterEnabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    if (!enabled(env.BING_WEBMASTER)) return false;
    if (!organizationId) return false;
    return orgAllowlist(env.BING_WEBMASTER_ORG_IDS).includes(organizationId.toLowerCase());
}
