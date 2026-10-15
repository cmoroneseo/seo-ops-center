import { NextRequest, NextResponse } from 'next/server';
import { Ga4PropertiesError, readGa4Properties } from '@/lib/google/ga4-properties';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { getGoogleAccessToken, type GoogleService } from '@/lib/sync/token';

async function getAccessToken(clientId: string, service: GoogleService) {
    try {
        const auth = await getGoogleAccessToken(clientId, service, {
            statuses: ['active', 'error', 'pending_setup'],
        });
        return auth?.token ?? null;
    } catch {
        return null;
    }
}

/**
 * GET /api/integrations/google/properties?clientId=...&group=ga4-gsc|gbp
 *
 * ga4-gsc: legacy group name; returns { ga4Properties } (GSC uses /google/gsc)
 * gbp:     returns { gbpLocations }
 */
export async function GET(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const group = req.nextUrl.searchParams.get('group') as 'ga4-gsc' | 'gbp' | null;

    if (!clientId || !group) {
        return NextResponse.json({ error: 'Missing clientId or group' }, { status: 400 });
    }

    if (!['ga4-gsc', 'gbp'].includes(group)) {
        return NextResponse.json({ error: 'Invalid group' }, { status: 400 });
    }

    const authorization = await requireClientIntegrationManager(clientId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    if (group === 'gbp') {
        const accessToken = await getAccessToken(authorization.clientId, 'gbp');
        if (!accessToken) {
            return NextResponse.json({ error: 'No GBP token found -- connect first' }, { status: 404 });
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
                    error: 'Business Profile Account Management API is not enabled. Enable it in Google Cloud Console -> APIs & Services -> Library -> search "Business Profile Account Management API".',
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
    const accessToken = await getAccessToken(authorization.clientId, 'ga4');
    if (!accessToken) {
        return NextResponse.json({ error: 'No GA4 token found -- connect first' }, { status: 404 });
    }

    try {
        const ga4Properties = await readGa4Properties(accessToken);
        return NextResponse.json({ ga4Properties });
    } catch (error) {
        if (error instanceof Ga4PropertiesError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('GA4 accountSummaries request failed', { status: 0 });
        return NextResponse.json({ error: 'Unable to list Analytics properties. Check Google access or reconnect.' }, { status: 502 });
    }
}
