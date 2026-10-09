import { createAdminClient } from '@/lib/supabase/admin';

export type GoogleService = 'ga4' | 'gsc' | 'gbp';

export class GoogleAuthError extends Error {
    readonly kind: 'reauth_required' | 'transient';

    constructor(message: string, kind: 'reauth_required' | 'transient') {
        super(message);
        this.name = 'GoogleAuthError';
        this.kind = kind;
    }
}

const REAUTH_ERRORS = new Set(['invalid_grant', 'unauthorized_client', 'invalid_client']);
const REAUTH_MESSAGE = 'Google authorization expired. Reconnect this integration.';

type IntegrationRow = {
    credentials: Record<string, unknown> | null;
    sync_status?: string;
    organization_id?: string;
};

export interface TokenDeps {
    admin: () => {
        from: (table: string) => TokenQuery;
    };
    fetch: typeof fetch;
    now: () => number;
    markError: (clientId: string, service: string, message: string) => Promise<void>;
}

interface TokenQuery {
    select: (columns: string) => TokenQuery;
    eq: (column: string, value: unknown) => TokenQuery;
    in: (column: string, values: readonly string[]) => TokenQuery;
    filter: (column: string, operator: string, value: string) => TokenQuery;
    update: (values: Record<string, unknown>) => TokenQuery;
    maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
}

const defaultTokenDeps: TokenDeps = {
    admin: () => createAdminClient() as unknown as ReturnType<TokenDeps['admin']>,
    fetch,
    now: () => Date.now(),
    markError: markIntegrationError,
};

/**
 * A usable Google access token for a client and service.
 * `active` and `error` rows are both eligible so one failed sync does not
 * lock the integration out of the next attempt. `pending_setup` and
 * `disconnected` return null.
 */
export async function getGoogleAccessToken(
    clientId: string,
    service: GoogleService,
    deps: TokenDeps = defaultTokenDeps,
): Promise<{ token: string; creds: Record<string, unknown> } | null> {
    const admin = deps.admin();
    const { data, error: readError } = await admin
        .from('client_integrations')
        .select('credentials, sync_status, organization_id')
        .eq('client_id', clientId)
        .eq('service', service)
        .in('sync_status', ['active', 'error'])
        .maybeSingle();

    if (readError) throw new GoogleAuthError('Unable to read integration credentials', 'transient');
    const row = data as IntegrationRow | null;
    if (!row?.credentials) return null;

    const creds = row.credentials;
    const accessToken = creds.access_token;
    const expiry = creds.expiry_date;
    if (
        typeof accessToken === 'string' && accessToken.length > 0
        && typeof expiry === 'number'
        && deps.now() <= expiry - 60_000
    ) {
        return { token: accessToken, creds };
    }

    const refreshToken = creds.refresh_token;
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
        await deps.markError(clientId, service, REAUTH_MESSAGE);
        throw new GoogleAuthError(REAUTH_MESSAGE, 'reauth_required');
    }

    const fresh = await refreshGoogleToken(refreshToken, deps);
    if (fresh.kind === 'reauth') {
        await deps.markError(clientId, service, REAUTH_MESSAGE);
        throw new GoogleAuthError(REAUTH_MESSAGE, 'reauth_required');
    }
    if (fresh.kind === 'transient') {
        throw new GoogleAuthError(fresh.message, 'transient');
    }

    const expiresIn = typeof fresh.expiresIn === 'number' && fresh.expiresIn > 0 ? fresh.expiresIn : 3600;
    const nextCreds = { ...creds, access_token: fresh.accessToken, expiry_date: deps.now() + expiresIn * 1000 };
    const { data: updated, error: updateError } = await admin
        .from('client_integrations')
        .update({ credentials: nextCreds })
        .eq('client_id', clientId)
        .eq('service', service)
        .filter('credentials', 'eq', JSON.stringify(creds))
        .select('id')
        .maybeSingle();

    if (!updateError && updated) return { token: fresh.accessToken, creds: nextCreds };

    const reread = await admin
        .from('client_integrations')
        .select('credentials, sync_status, organization_id')
        .eq('client_id', clientId)
        .eq('service', service)
        .maybeSingle();
    const latest = (reread.data as IntegrationRow | null)?.credentials;
    const latestToken = latest?.access_token;
    const latestExpiry = latest?.expiry_date;
    if (
        latest
        && typeof latestToken === 'string' && latestToken.length > 0
        && typeof latestExpiry === 'number'
        && deps.now() <= latestExpiry - 60_000
    ) {
        return { token: latestToken, creds: latest };
    }
    throw new GoogleAuthError('Connection changed during sync', 'transient');
}

type RefreshResult =
    | { kind: 'ok'; accessToken: string; expiresIn: number }
    | { kind: 'reauth' }
    | { kind: 'transient'; message: string };

async function refreshGoogleToken(refreshToken: string, deps: TokenDeps): Promise<RefreshResult> {
    let response: Response;
    try {
        response = await deps.fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                refresh_token: refreshToken,
                client_id: process.env.GOOGLE_CLIENT_ID ?? '',
                client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
                grant_type: 'refresh_token',
            }),
        });
    } catch {
        return { kind: 'transient', message: 'Google token refresh failed' };
    }

    let payload: { access_token?: unknown; expires_in?: unknown; error?: unknown } = {};
    try {
        payload = await response.json();
    } catch {
        payload = {};
    }

    if (!response.ok) {
        const code = typeof payload.error === 'string' ? payload.error : '';
        if ((response.status === 400 || response.status === 401) && REAUTH_ERRORS.has(code)) {
            return { kind: 'reauth' };
        }
        return { kind: 'transient', message: `Google token refresh failed (HTTP ${response.status})` };
    }

    if (typeof payload.access_token !== 'string') {
        return { kind: 'transient', message: 'Google token refresh failed' };
    }
    return {
        kind: 'ok',
        accessToken: payload.access_token,
        expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
    };
}

/** Mark an integration as errored so the AM sees it in the UI. */
export async function markIntegrationError(clientId: string, service: string, message: string) {
    const admin = createAdminClient();
    const { error } = await admin.from('client_integrations').update({
        sync_status: 'error',
        error_message: message,
    }).eq('client_id', clientId).eq('service', service);
    if (error) throw new Error('Unable to update integration sync status');
}

/** Update last_synced_at after a successful fetch. */
export async function markIntegrationSynced(clientId: string, service: string) {
    const admin = createAdminClient();
    const { error } = await admin.from('client_integrations').update({
        sync_status: 'active',
        last_synced_at: new Date().toISOString(),
        error_message: null,
    }).eq('client_id', clientId).eq('service', service);
    if (error) throw new Error('Unable to update integration sync status');
}
