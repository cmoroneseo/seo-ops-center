/**
 * SEO Plan v2 (Overview and Plan IA). Off unless both are set.
 *
 * `SEO_PLAN_V2` must be the exact string `true`.
 * `SEO_PLAN_V2_ORG_IDS` is a required comma-separated organization allowlist.
 * An unset, empty, or non-matching allowlist stays off, including when the
 * master switch is true. Start with the Sandbox org only.
 */

export const SEO_PLAN_SANDBOX_ORG_ID = '06e536b9-beac-49bc-8c96-1df021102590';

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

export function seoPlanV2Enabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    if (!enabled(env.SEO_PLAN_V2)) return false;
    if (!organizationId) return false;
    return orgAllowlist(env.SEO_PLAN_V2_ORG_IDS).includes(organizationId.toLowerCase());
}
