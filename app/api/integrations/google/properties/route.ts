import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Refresh an expired Google access token using the stored refresh_token. */
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
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

/**
 * GET /api/integrations/google/properties?clientId=...
 *
 * Uses the stored OAuth token for this client to fetch:
 * - GA4 account summaries (all properties the user can access)
 * - GSC verified sites
 *
 * Returns { ga4Properties, gscSites }
 */
export async function GET(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get('clientId');
    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    // Fetch credentials for ga4 (ga4 and gsc share the same token)
    const { data: row, error } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', 'ga4')
        .maybeSingle();

    if (error || !row) {
        return NextResponse.json({ error: 'No GA4 integration found — connect first' }, { status: 404 });
    }

    const creds = row.credentials as any;
    let accessToken: string = creds.access_token;

    // Refresh if expired
    if (creds.expiry_date && Date.now() > creds.expiry_date - 60_000) {
        const fresh = await refreshAccessToken(creds.refresh_token);
        if (!fresh) return NextResponse.json({ error: 'Token expired — please reconnect' }, { status: 401 });
        accessToken = fresh;
        // Update stored token
        await admin.from('client_integrations').update({
            credentials: { ...creds, access_token: fresh, expiry_date: Date.now() + 3600_000 },
        }).eq('client_id', clientId).eq('service', 'ga4');
    }

    const headers = { Authorization: `Bearer ${accessToken}` };

    // Fetch GA4 account summaries
    const [ga4Res, gscRes] = await Promise.all([
        fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', { headers }),
        fetch('https://www.googleapis.com/webmasters/v3/sites', { headers }),
    ]);

    const [ga4Data, gscData] = await Promise.all([ga4Res.json(), gscRes.json()]);

    // Flatten GA4 account summaries into a flat property list
    const ga4Properties: { id: string; displayName: string; account: string }[] = [];
    for (const account of ga4Data.accountSummaries ?? []) {
        for (const prop of account.propertySummaries ?? []) {
            ga4Properties.push({
                id: prop.property,           // e.g. "properties/123456789"
                displayName: prop.displayName,
                account: account.displayName,
            });
        }
    }

    // GSC sites
    const gscSites: { siteUrl: string; permissionLevel: string }[] =
        (gscData.siteEntry ?? []).map((s: any) => ({
            siteUrl: s.siteUrl,
            permissionLevel: s.permissionLevel,
        }));

    return NextResponse.json({ ga4Properties, gscSites });
}
