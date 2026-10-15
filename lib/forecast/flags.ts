/**
 * Campaign Desk forecast sync. Off unless every gate passes.
 *
 * `CAMPAIGN_DESK_SYNC_ENABLED` must be the exact string `true`.
 * `CAMPAIGN_DESK_ORG_IDS` is a required comma-separated organization allowlist.
 * An unset, empty, or non-matching allowlist stays off, including when the
 * master switch is true. Sandbox is the first org to allowlist. The production
 * org stays off until a sandbox sync has been checked by hand.
 *
 * The API base URL and bearer token are server-only. This module never returns
 * the token.
 */

export const CAMPAIGN_DESK_SANDBOX_ORG_ID = '06e536b9-beac-49bc-8c96-1df021102590';

export const CAMPAIGN_DESK_MEG_ORG_ID = '51f63cc5-4c52-45ed-bb20-2d5ce6320bf2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ForecastReadiness {
    enabled: boolean;
    /** Set when a sync must not run. Null when the gates are open. */
    reason: string | null;
}

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

export function campaignDeskAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
    if (!enabled(env.CAMPAIGN_DESK_SYNC_ENABLED)) return [];
    return orgAllowlist(env.CAMPAIGN_DESK_ORG_IDS);
}

/**
 * A usable base URL, with no trailing slash.
 * https is required. http is accepted only for localhost, so a developer can
 * point at Campaign Desk on their own machine.
 */
export function campaignDeskBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
    const raw = env.CAMPAIGN_DESK_API_BASE_URL;
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && local);
    if (!allowed || url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path === '/' ? '' : path}`;
}

function token(env: NodeJS.ProcessEnv): string | null {
    const raw = env.CAMPAIGN_DESK_API_TOKEN;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

/**
 * Version 2 sends one item per day. Off unless the value is exactly `true`.
 * Any other value, including unset, keeps the version 1 weekly payload.
 */
export function campaignDeskSyncV2(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.CAMPAIGN_DESK_SYNC_V2 === 'true';
}

/** True only when this organization may call Campaign Desk. */
export function campaignDeskReady(
    organizationId: string,
    env: NodeJS.ProcessEnv = process.env,
): ForecastReadiness {
    if (!enabled(env.CAMPAIGN_DESK_SYNC_ENABLED)) {
        return { enabled: false, reason: 'Campaign Desk sync is turned off.' };
    }
    if (!organizationId || !orgAllowlist(env.CAMPAIGN_DESK_ORG_IDS).includes(organizationId.toLowerCase())) {
        return { enabled: false, reason: 'This organization is not allowed to sync to Campaign Desk.' };
    }
    const rawUrl = env.CAMPAIGN_DESK_API_BASE_URL;
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
        return { enabled: false, reason: 'CAMPAIGN_DESK_API_BASE_URL is not set.' };
    }
    if (!campaignDeskBaseUrl(env)) {
        return { enabled: false, reason: 'CAMPAIGN_DESK_API_BASE_URL must be an https URL.' };
    }
    if (!token(env)) {
        return { enabled: false, reason: 'CAMPAIGN_DESK_API_TOKEN is not set.' };
    }
    return { enabled: true, reason: null };
}

/**
 * Server-only shared secret. Empty or whitespace is missing.
 * Callers must not log the return value or put it in a response.
 */
export function campaignDeskToken(env: NodeJS.ProcessEnv = process.env): string | null {
    return token(env);
}
