import { GA4_ANALYTICS_SCOPE } from '@/lib/google/account';

/** Same text token.ts writes when Google rejects the refresh token. */
export const GA4_REAUTH_ERROR = 'Google authorization expired. Reconnect this integration.';

export const GA4_RECONNECT_ANALYTICS_LABEL = 'Reconnect to add Analytics';

export type Ga4ConnectionHealth = 'reconnect_analytics' | 'reauth_required';

export function parseGrantedScopes(scope: unknown): string[] {
    if (typeof scope !== 'string') return [];
    const seen = new Set<string>();
    for (const part of scope.split(/\s+/)) {
        const trimmed = part.trim();
        if (trimmed) seen.add(trimmed);
    }
    return [...seen];
}

/**
 * Legacy rows have no granted_scopes and are left alone. A stored grant that
 * does not include Analytics is a partial consent, even when the row is active.
 * Revoked refresh tokens are the reauth message written by the token helper.
 */
export function ga4ConnectionHealth(input: {
    syncStatus?: string | null;
    errorMessage?: string | null;
    grantedScopes?: unknown;
}): Ga4ConnectionHealth | null {
    if (!input.syncStatus || input.syncStatus === 'disconnected') return null;
    if (input.syncStatus === 'error' && input.errorMessage === GA4_REAUTH_ERROR) return 'reauth_required';
    if (!Array.isArray(input.grantedScopes)) return null;
    const scopes = input.grantedScopes.filter((scope): scope is string => typeof scope === 'string' && scope.length > 0);
    if (scopes.includes(GA4_ANALYTICS_SCOPE)) return null;
    return 'reconnect_analytics';
}
