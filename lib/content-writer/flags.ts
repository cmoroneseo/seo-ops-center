/**
 * Content writer switches. All default off.
 *
 * `content_writer` is the master switch (`CONTENT_WRITER_ENABLED`).
 * `content_writer_llm` allows model calls (`CONTENT_WRITER_LLM_ENABLED`)
 * and also requires the master switch.
 * `content_writer_spec` shows the page spec drawer and manual add
 * (`CONTENT_WRITER_SPEC_ENABLED`) and also requires the master switch.
 *
 * Unset, empty, or any value other than the exact string `true` stays off.
 * `CONTENT_WRITER_ORG_IDS`, when set, is a comma-separated organization
 * allowlist. A call without a matching organization id stays off.
 */

export const CONTENT_WRITER_FLAG = 'content_writer';
export const CONTENT_WRITER_LLM_FLAG = 'content_writer_llm';
export const CONTENT_WRITER_SPEC_FLAG = 'content_writer_spec';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function enabled(value: string | undefined): boolean {
    return value === 'true';
}

/**
 * `null` means no allowlist (every org). An empty array means the variable
 * was set but contained no organization id, which allows nobody.
 */
function orgAllowlist(raw: string | undefined): string[] | null {
    if (raw == null || raw.trim() === '') return null;
    return raw
        .split(',')
        .map(part => part.trim().toLowerCase())
        .filter(part => UUID.test(part));
}

function organizationAllowed(raw: string | undefined, organizationId?: string): boolean {
    const allowlist = orgAllowlist(raw);
    if (allowlist == null) return true;
    if (!organizationId) return false;
    return allowlist.includes(organizationId.toLowerCase());
}

export function contentWriterEnabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    return enabled(env.CONTENT_WRITER_ENABLED)
        && organizationAllowed(env.CONTENT_WRITER_ORG_IDS, organizationId);
}

export function contentWriterLlmEnabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    return contentWriterEnabled(env, organizationId)
        && enabled(env.CONTENT_WRITER_LLM_ENABLED);
}

export function contentWriterSpecEnabled(
    env: NodeJS.ProcessEnv = process.env,
    organizationId?: string,
): boolean {
    return contentWriterEnabled(env, organizationId)
        && enabled(env.CONTENT_WRITER_SPEC_ENABLED);
}
