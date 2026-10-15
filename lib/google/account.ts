export type GoogleOAuthGroup = 'ga4-gsc' | 'ga4' | 'gsc' | 'gbp';

/** The only `group` query values the connect route will send to Google. */
export const GOOGLE_OAUTH_GROUPS: ReadonlySet<string> = new Set<string>([
    'ga4-gsc',
    'ga4',
    'gsc',
    'gbp',
]);

export const GA4_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

const SERVICE_SCOPES: Record<GoogleOAuthGroup, readonly string[]> = {
    'ga4-gsc': [
        GA4_ANALYTICS_SCOPE,
        'https://www.googleapis.com/auth/webmasters.readonly',
    ],
    ga4: [GA4_ANALYTICS_SCOPE],
    gsc: ['https://www.googleapis.com/auth/webmasters.readonly'],
    gbp: ['https://www.googleapis.com/auth/business.manage'],
};

/** Identity scopes so the token exchange can record which Google account connected. */
export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email'] as const;

export function isGoogleOAuthGroup(group: string | null): group is GoogleOAuthGroup {
    return group !== null && GOOGLE_OAUTH_GROUPS.has(group);
}

/** Scopes for a group that has already passed `GOOGLE_OAUTH_GROUPS`. */
export function googleOAuthScopes(group: GoogleOAuthGroup): string[] {
    return [...SERVICE_SCOPES[group], ...GOOGLE_IDENTITY_SCOPES];
}

/** Consent keeps the refresh token. select_account lets the user pick a different Google login. */
export function googleOAuthPrompt(): string {
    return 'consent select_account';
}

/** GA4 and Search Console share one consent. The group is not rewritten to ga4-only. */
export function googleConnectPath(clientId: string, orgId: string, group: GoogleOAuthGroup): string {
    const params = new URLSearchParams({ clientId, orgId, group });
    return `/api/integrations/google/connect?${params.toString()}`;
}

const RESOURCE_KEY = { ga4: 'property_id', gsc: 'site_url', gbp: 'location_name' } as const;

/**
 * A reconnect keeps an already chosen property active. A first consent still
 * waits for the picker. Search Console is not sent back to setup when GA4
 * reuses the shared ga4-gsc grant.
 */
export function syncStatusAfterGoogleReconnect(input: {
    service: 'ga4' | 'gsc' | 'gbp';
    previousStatus?: string | null;
    credentials?: Record<string, unknown> | null;
}): 'active' | 'pending_setup' {
    const value = input.credentials?.[RESOURCE_KEY[input.service]];
    const ready = typeof value === 'string' && value.length > 0;
    if (ready && (input.previousStatus === 'active' || input.previousStatus === 'error')) return 'active';
    return 'pending_setup';
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/** The only account identifier safe to show in the browser. Tokens never qualify. */
export function publicGoogleEmail(credentials: Record<string, unknown> | null | undefined): string | undefined {
    const value = credentials?.google_email;
    if (typeof value !== 'string') return undefined;
    const email = value.trim();
    if (!email || email.length > 254 || !EMAIL.test(email)) return undefined;
    return email;
}

export function connectedAccountLabel(email?: string): string | undefined {
    const safe = publicGoogleEmail(email ? { google_email: email } : undefined);
    return safe ? `Connected as ${safe}` : undefined;
}

export function googleAccountEmptyHint(email: string): string {
    return `Don't see it? This list shows properties for ${email}. Reconnect with another Google account.`;
}

/**
 * OpenID userinfo. Failures return null and log only the HTTP status.
 */
export async function readGoogleAccountEmail(
    accessToken: string,
    request: typeof fetch = fetch,
    log: (status: number) => void = status => { console.error('Google userinfo request failed', { status }); },
): Promise<string | null> {
    let response: Response;
    try {
        response = await request('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
        });
    } catch {
        log(0);
        return null;
    }
    if (!response.ok) {
        log(response.status);
        return null;
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object' || (data as { email_verified?: unknown }).email_verified === false) return null;
    return publicGoogleEmail({ google_email: (data as { email?: unknown }).email }) ?? null;
}
