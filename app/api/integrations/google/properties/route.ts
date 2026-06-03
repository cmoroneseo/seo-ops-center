import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

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

async function getAccessToken(admin: any, clientId: string, service: string) {
    const { data: row } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', service)
        .maybeSingle();

    if (!row) return null;
    const creds = row.credentials as any;
    let accessToken: string = creds.access_token;

    if (creds.expiry_date && Date.now() > creds.expiry_date - 60_000) {
        const fresh = await refreshAccessToken(creds.refresh_token);
        if (!fresh) return null;
        accessToken = fresh;
        await admin.from('client_integrations').update({
            credentials: { ...creds, access_token: fresh, expiry_date: Date.now() + 3600_000 },
        }).eq('client_id', clientId).eq('service', service);
    }

    return accessToken;
}

/**
 * GET /api/integrations/google/properties?clientId=...&group=ga4-gsc|gbp
 *
 * ga4-gsc: returns { ga4Properties, gscSites }
 * gbp:     returns { gbpLocations }
 */
export async function GET(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const group = req.nextUrl.searchParams.get('group') as 'ga4-gsc' | 'gbp' | null;

    if (!clientId || !group) {
        return NextResponse.json({ error: 'Missing clientId or group' }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    if (group === 'gbp') {
        const accessToken = await getAccessToken(admin, clientId, 'gbp');
        if (!accessToken) {
            return NextResponse.json({ error: 'No GBP token found — connect first' }, { status: 404 });
        }

        const headers = { Authorization: `Bearer ${accessToken}` };

        // 1. List GBP accounts
        const accountsRes = await fetch(
            'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
            { headers },
        );
        const accountsData = await accountsRes.json();

        // Surface API errors clearly instead of silently returning empty
        if (!accountsRes.ok) {
            const msg = accountsData?.error?.message || accountsData?.error?.status || 'Unknown error';
            const status = accountsData?.error?.status;
            if (status === 'PERMISSION_DENIED' || accountsRes.status === 403) {
                return NextResponse.json({
                    error: 'Business Profile Account Management API is not enabled. Enable it in Google Cloud Console → APIs & Services → Library → search "Business Profile Account Management API".',
                }, { status: 403 });
            }
            return NextResponse.json({ error: `GBP API error: ${msg}` }, { status: accountsRes.status });
        }

        const accounts: any[] = accountsData.accounts ?? [];

        if (accounts.length === 0) {
            return NextResponse.json({ gbpLocations: [], warning: 'No Business Profile accounts found on this Google account. Make sure the connected account has access to Google Business Profile.' });
        }

        // 2. For each account, list locations
        const locationFetches = accounts.map((acct) =>
            fetch(
                `https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations?readMask=name,title,storefrontAddress`,
                { headers },
            ).then(async (r) => {
                const d = await r.json();
                if (!r.ok) console.error(`GBP locations error for ${acct.name}:`, d?.error?.message);
                return { account: acct, locations: d.locations ?? [] };
            }),
        );
        const results = await Promise.all(locationFetches);

        const gbpLocations: { name: string; title: string; address: string; accountName: string }[] = [];
        for (const { account, locations } of results) {
            for (const loc of locations) {
                const addr = loc.storefrontAddress;
                const addressStr = addr
                    ? [addr.addressLines?.[0], addr.locality, addr.administrativeArea].filter(Boolean).join(', ')
                    : '';
                gbpLocations.push({
                    name: loc.name,
                    title: loc.title,
                    address: addressStr,
                    accountName: account.accountName,
                });
            }
        }

        return NextResponse.json({ gbpLocations });
    }

    // ga4-gsc group
    const accessToken = await getAccessToken(admin, clientId, 'ga4');
    if (!accessToken) {
        return NextResponse.json({ error: 'No GA4 token found — connect first' }, { status: 404 });
    }

    const headers = { Authorization: `Bearer ${accessToken}` };

    const [ga4Res, gscRes] = await Promise.all([
        fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', { headers }),
        fetch('https://www.googleapis.com/webmasters/v3/sites', { headers }),
    ]);
    const [ga4Data, gscData] = await Promise.all([ga4Res.json(), gscRes.json()]);

    const ga4Properties: { id: string; displayName: string; account: string }[] = [];
    for (const account of ga4Data.accountSummaries ?? []) {
        for (const prop of account.propertySummaries ?? []) {
            ga4Properties.push({
                id: prop.property,
                displayName: prop.displayName,
                account: account.displayName,
            });
        }
    }

    const gscSites: { siteUrl: string; permissionLevel: string }[] =
        (gscData.siteEntry ?? []).map((s: any) => ({
            siteUrl: s.siteUrl,
            permissionLevel: s.permissionLevel,
        }));

    return NextResponse.json({ ga4Properties, gscSites });
}
