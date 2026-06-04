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
    const { data: row } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', service)
        .eq('sync_status', 'active')
        .maybeSingle();

    if (!row?.credentials) return null;
    const creds = row.credentials as Record<string, any>;
    let accessToken: string = creds.access_token;

    // Refresh if within 60s of expiry
    if (creds.expiry_date && Date.now() > creds.expiry_date - 60_000) {
        const fresh = await refreshGoogleToken(creds.refresh_token);
        if (!fresh) return null;
        accessToken = fresh;
        const newExpiry = Date.now() + 3_600_000;
        await admin.from('client_integrations').update({
            credentials: { ...creds, access_token: fresh, expiry_date: newExpiry },
        }).eq('client_id', clientId).eq('service', service);
        return { token: accessToken, creds: { ...creds, access_token: fresh, expiry_date: newExpiry } };
    }

    return { token: accessToken, creds };
}

async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: 'refresh_token',
        }),
    });
    const data = await res.json();
    return data.access_token ?? null;
}

/** Mark an integration as errored so the AM sees it in the UI. */
export async function markIntegrationError(clientId: string, service: string, message: string) {
    const admin = createAdminClient();
    await admin.from('client_integrations').update({
        sync_status: 'error',
        error_message: message,
    }).eq('client_id', clientId).eq('service', service);
}

/** Update last_synced_at after a successful fetch. */
export async function markIntegrationSynced(clientId: string, service: string) {
    const admin = createAdminClient();
    await admin.from('client_integrations').update({
        sync_status: 'active',
        last_synced_at: new Date().toISOString(),
        error_message: null,
    }).eq('client_id', clientId).eq('service', service);
}
