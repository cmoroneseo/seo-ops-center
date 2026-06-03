import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/integrations/google/configure
 * Body: { clientId, ga4PropertyId, ga4DisplayName, gscSiteUrl }
 *
 * Merges the selected property IDs into the stored credentials and
 * flips sync_status from 'pending_setup' → 'active'.
 */
export async function POST(req: NextRequest) {
    const { clientId, ga4PropertyId, ga4DisplayName, gscSiteUrl } = await req.json();

    if (!clientId || (!ga4PropertyId && !gscSiteUrl)) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    const updates: PromiseLike<any>[] = [];

    if (ga4PropertyId) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials')
            .eq('client_id', clientId)
            .eq('service', 'ga4')
            .maybeSingle();

        if (row) {
            updates.push(
                admin.from('client_integrations').update({
                    credentials: { ...row.credentials, property_id: ga4PropertyId, display_name: ga4DisplayName },
                    sync_status: 'active',
                }).eq('client_id', clientId).eq('service', 'ga4'),
            );
        }
    }

    if (gscSiteUrl) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials')
            .eq('client_id', clientId)
            .eq('service', 'gsc')
            .maybeSingle();

        if (row) {
            updates.push(
                admin.from('client_integrations').update({
                    credentials: { ...row.credentials, site_url: gscSiteUrl },
                    sync_status: 'active',
                }).eq('client_id', clientId).eq('service', 'gsc'),
            );
        }
    }

    await Promise.all(updates);
    return NextResponse.json({ success: true });
}
