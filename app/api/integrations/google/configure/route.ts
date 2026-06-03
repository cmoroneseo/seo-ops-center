import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/integrations/google/configure
 *
 * Merges the selected property/location into stored credentials and
 * flips sync_status from 'pending_setup' → 'active'.
 *
 * GA4+GSC body: { clientId, ga4PropertyId, ga4DisplayName, gscSiteUrl }
 * GBP body:     { clientId, gbpLocationName, gbpTitle, gbpAddress }
 */
export async function POST(req: NextRequest) {
    const body = await req.json();
    const { clientId } = body;

    if (!clientId) {
        return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    const updates: PromiseLike<any>[] = [];

    // GA4
    if (body.ga4PropertyId) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials')
            .eq('client_id', clientId)
            .eq('service', 'ga4')
            .maybeSingle();

        if (row) {
            updates.push(
                admin.from('client_integrations').update({
                    credentials: {
                        ...row.credentials,
                        property_id: body.ga4PropertyId,
                        display_name: body.ga4DisplayName,
                    },
                    sync_status: 'active',
                }).eq('client_id', clientId).eq('service', 'ga4'),
            );
        }
    }

    // GSC
    if (body.gscSiteUrl) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials')
            .eq('client_id', clientId)
            .eq('service', 'gsc')
            .maybeSingle();

        if (row) {
            updates.push(
                admin.from('client_integrations').update({
                    credentials: { ...row.credentials, site_url: body.gscSiteUrl },
                    sync_status: 'active',
                }).eq('client_id', clientId).eq('service', 'gsc'),
            );
        }
    }

    // GBP
    if (body.gbpLocationName) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials')
            .eq('client_id', clientId)
            .eq('service', 'gbp')
            .maybeSingle();

        if (row) {
            updates.push(
                admin.from('client_integrations').update({
                    credentials: {
                        ...row.credentials,
                        location_name: body.gbpLocationName,   // "accounts/123/locations/456"
                        location_title: body.gbpTitle,
                        location_address: body.gbpAddress,
                    },
                    sync_status: 'active',
                }).eq('client_id', clientId).eq('service', 'gbp'),
            );
        }
    }

    if (updates.length === 0) {
        return NextResponse.json({ error: 'Nothing to configure' }, { status: 400 });
    }

    await Promise.all(updates);
    return NextResponse.json({ success: true });
}
