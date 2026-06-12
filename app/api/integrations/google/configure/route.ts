import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';

async function readJsonBody(req: NextRequest) {
    try {
        return await req.json();
    } catch {
        return null;
    }
}

/**
 * POST /api/integrations/google/configure
 *
 * Merges the selected property/location into stored credentials and
 * flips sync_status from 'pending_setup' -> 'active'.
 *
 * GA4+GSC body: { clientId, orgId?, ga4PropertyId, ga4DisplayName, gscSiteUrl }
 * GBP body:     { clientId, orgId?, gbpLocationName, gbpTitle, gbpAddress }
 */
export async function POST(req: NextRequest) {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { clientId, orgId } = body as Record<string, unknown>;
    const authorization = await requireClientIntegrationManager(clientId, orgId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    const updates: PromiseLike<any>[] = [];
    const activityEvents: Parameters<typeof logClientActivity>[0][] = [];

    // GA4
    if ((body as any).ga4PropertyId) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials, sync_status')
            .eq('client_id', authorization.clientId)
            .eq('service', 'ga4')
            .maybeSingle();

        if (row) {
            const isReconfigure = row.sync_status === 'active' && row.credentials?.property_id;
            updates.push(
                admin.from('client_integrations').update({
                    credentials: { ...row.credentials, property_id: (body as any).ga4PropertyId, display_name: (body as any).ga4DisplayName },
                    sync_status: 'active',
                }).eq('client_id', authorization.clientId).eq('service', 'ga4'),
            );
            activityEvents.push({
                organizationId: authorization.organizationId,
                clientId: authorization.clientId,
                eventType: isReconfigure ? 'integration.reconfigured' : 'integration.connected',
                actorId: authorization.userId,
                actorName: authorization.actorName,
                metadata: {
                    service: 'ga4',
                    display_name: (body as any).ga4DisplayName,
                    property_id: (body as any).ga4PropertyId,
                    ...(isReconfigure && { old_property_id: row.credentials.property_id }),
                },
            });
        }
    }

    // GSC
    if ((body as any).gscSiteUrl) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials, sync_status')
            .eq('client_id', authorization.clientId)
            .eq('service', 'gsc')
            .maybeSingle();

        if (row) {
            const isReconfigure = row.sync_status === 'active' && row.credentials?.site_url;
            updates.push(
                admin.from('client_integrations').update({
                    credentials: { ...row.credentials, site_url: (body as any).gscSiteUrl },
                    sync_status: 'active',
                }).eq('client_id', authorization.clientId).eq('service', 'gsc'),
            );
            activityEvents.push({
                organizationId: authorization.organizationId,
                clientId: authorization.clientId,
                eventType: isReconfigure ? 'integration.reconfigured' : 'integration.connected',
                actorId: authorization.userId,
                actorName: authorization.actorName,
                metadata: {
                    service: 'gsc',
                    display_name: (body as any).gscSiteUrl,
                    ...(isReconfigure && { old_display_name: row.credentials.site_url }),
                },
            });
        }
    }

    // GBP
    if ((body as any).gbpLocationName) {
        const { data: row } = await admin
            .from('client_integrations')
            .select('credentials, sync_status')
            .eq('client_id', authorization.clientId)
            .eq('service', 'gbp')
            .maybeSingle();

        if (row) {
            const isReconfigure = row.sync_status === 'active' && row.credentials?.location_name;
            updates.push(
                admin.from('client_integrations').update({
                    credentials: {
                        ...row.credentials,
                        location_name: (body as any).gbpLocationName,
                        location_title: (body as any).gbpTitle,
                        location_address: (body as any).gbpAddress,
                    },
                    sync_status: 'active',
                }).eq('client_id', authorization.clientId).eq('service', 'gbp'),
            );
            activityEvents.push({
                organizationId: authorization.organizationId,
                clientId: authorization.clientId,
                eventType: isReconfigure ? 'integration.reconfigured' : 'integration.connected',
                actorId: authorization.userId,
                actorName: authorization.actorName,
                metadata: {
                    service: 'gbp',
                    display_name: (body as any).gbpTitle,
                    location_address: (body as any).gbpAddress,
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
