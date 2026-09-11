import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Fetch a valid Google access token for a client+service.
 * Refreshes automatically if expired. Returns null if not connected or refresh fails.
 */
export async function getGoogleAccessToken(
    clientId: string,
    service: 'ga4' | 'gsc' | 'gbp',
): Promise<{ token: string; creds: Record<string, any> } | null> {
    const admin = createAdminClient();
    const { data: row, error: readError } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', service)
        .in('sync_status', service === 'gsc' ? ['active', 'error'] : ['active'])
        .maybeSingle();

    if (readError) throw new Error('Unable to read integration credentials');
    if (!row?.credentials) return null;
    const creds = row.credentials as Record<string, any>;
    let accessToken: string = creds.access_token;

    // Refresh if within 60s of expiry
    if (!accessToken || !creds.expiry_date || Date.now() > creds.expiry_date - 60_000) {
        const fresh = await refreshGoogleToken(creds.refresh_token);
        if (!fresh) {
            const message = 'Google authorization expired. Reconnect this integration.';
            await markIntegrationError(clientId, service, message);
            throw new Error(message);
        }
        accessToken = fresh;
        const newExpiry = Date.now() + 3_600_000;
        const { error: updateError } = await admin.from('client_integrations').update({
            credentials: { ...creds, access_token: fresh, expiry_date: newExpiry },
        }).eq('client_id', clientId).eq('service', service)
            .filter('credentials', 'eq', JSON.stringify(creds)).select('id').single();
        if (updateError) throw new Error('Connection changed during sync. Please retry.');
        return { token: accessToken, creds: { ...creds, access_token: fresh, expiry_date: newExpiry } };
    }

    return { token: accessToken, creds };
}

async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
    if (!refreshToken) return null;
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: 'refresh_token',
        }),
    });
    const data = await res.json();
    return res.ok && typeof data.access_token === 'string' ? data.access_token : null;
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
