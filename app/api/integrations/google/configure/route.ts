import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { logClientActivity } from '@/lib/supabase/client-activity';

/**
 * POST /api/integrations/google/configure
 *
 * Merges the selected property/location into stored credentials and
 * flips sync_status from 'pending_setup' → 'active'.
 *
 * GA4+GSC body: { clientId, orgId, ga4PropertyId, ga4DisplayName, gscSiteUrl }
 * GBP body:     { clientId, orgId, gbpLocationName, gbpTitle, gbpAddress }
 */
export async function POST(req: NextRequest) {
    const body = await req.json();
    const { clientId, orgId } = body;

    if (!clientId) {
        return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    // Resolve actor
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id;
    const actorName = user?.user_metadata?.full_name || user?.email || 'Unknown';

    // Resolve orgId if not passed (look it up from the integration row)
    let organizationId = orgId;
    if (!organizationId) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('organization_id')
            .eq('client_id', clientId)
            .maybeSingle();
        organizationId = row?.organization_id;
    }

    const updates: PromiseLike<any>[] = [];
    const activityEvents: Parameters<typeof logClientActivity>[0][] = [];

    // GA4
    if (body.ga4PropertyId) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials, sync_status')
            .eq('client_id', clientId)
            .eq('service', 'ga4')
            .maybeSingle();

        if (row) {
            const isReconfigure = row.sync_status === 'active' && row.credentials?.property_id;
            updates.push(
                admin.from('client_integrations').update({
                    credentials: { ...row.credentials, property_id: body.ga4PropertyId, display_name: body.ga4DisplayName },
                    sync_status: 'active',
                }).eq('client_id', clientId).eq('service', 'ga4'),
            );
            activityEvents.push({
                organizationId,
                clientId,
                eventType: isReconfigure ? 'integration.reconfigured' : 'integration.connected',
                actorId,
                actorName,
                metadata: {
                    service: 'ga4',
                    display_name: body.ga4DisplayName,
                    property_id: body.ga4PropertyId,
                    ...(isReconfigure && { old_property_id: row.credentials.property_id }),
                },
            });
        }
    }

    // GSC
    if (body.gscSiteUrl) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials, sync_status')
            .eq('client_id', clientId)
            .eq('service', 'gsc')
            .maybeSingle();

        if (row) {
            const isReconfigure = row.sync_status === 'active' && row.credentials?.site_url;
            updates.push(
                admin.from('client_integrations').update({
                    credentials: { ...row.credentials, site_url: body.gscSiteUrl },
                    sync_status: 'active',
                }).eq('client_id', clientId).eq('service', 'gsc'),
            );
            activityEvents.push({
                organizationId,
                clientId,
                eventType: isReconfigure ? 'integration.reconfigured' : 'integration.connected',
                actorId,
                actorName,
                metadata: {
                    service: 'gsc',
                    display_name: body.gscSiteUrl,
                    ...(isReconfigure && { old_display_name: row.credentials.site_url }),
                },
            });
        }
    }

    // GBP
    if (body.gbpLocationName) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials, sync_status')
            .eq('client_id', clientId)
            .eq('service', 'gbp')
            .maybeSingle();

        if (row) {
            const isReconfigure = row.sync_status === 'active' && row.credentials?.location_name;
            updates.push(
                admin.from('client_integrations').update({
                    credentials: {
                        ...row.credentials,
                        location_name: body.gbpLocationName,
                        location_title: body.gbpTitle,
                        location_address: body.gbpAddress,
                    },
                    sync_status: 'active',
                }).eq('client_id', clientId).eq('service', 'gbp'),
            );
            activityEvents.push({
                organizationId,
                clientId,
                eventType: isReconfigure ? 'integration.reconfigured' : 'integration.connected',
                actorId,
                actorName,
                metadata: {
                    service: 'gbp',
                    display_name: body.gbpTitle,
                    location_address: body.gbpAddress,
                    ...(isReconfigure && { old_display_name: row.credentials.location_title }),
                },
            });
        }
    }

    if (updates.length === 0) {
        return NextResponse.json({ error: 'Nothing to configure' }, { status: 400 });
    }

    await Promise.all([
        ...updates,
        ...activityEvents.map(logClientActivity),
    ]);

    return NextResponse.json({ success: true });
}
