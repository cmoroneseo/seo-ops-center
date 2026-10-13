/**
 * Context Vault switches. Off unless both are set.
 *
 * `VAULT_ENABLED` must be the exact string `true`.
 * `VAULT_ORG_IDS` is a required comma-separated organization allowlist.
 * An unset, empty, or non-matching allowlist stays off, including when the
 * master switch is true. Start with the Sandbox org only.
 */

export const VAULT_SANDBOX_ORG_ID = '06e536b9-beac-49bc-8c96-1df021102590';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function enabled(value: string | undefined): boolean {
    return value === 'true';
}

/** An empty result means the variable was set but named no organization. */
function orgAllowlist(raw: string | undefined): string[] {
    if (raw == null || raw.trim() === '') return [];
    return raw
        .split(',')
        .map(part => part.trim().toLowerCase())
        .filter(part => UUID.test(part));
}

export function vaultEnabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    if (!enabled(env.VAULT_ENABLED)) return false;
    if (!organizationId) return false;
    return orgAllowlist(env.VAULT_ORG_IDS).includes(organizationId.toLowerCase());
}
