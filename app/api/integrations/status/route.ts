import { NextRequest, NextResponse } from 'next/server';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { ClientIntegration, IntegrationService } from '@/lib/types';

const PROPERTY_FIELD: Partial<Record<IntegrationService, string>> = {
    ga4: 'property_id',
    gsc: 'site_url',
    gbp: 'location_name',
};

function toSafeIntegration(row: any): ClientIntegration {
    const credentials = (row.credentials ?? {}) as Record<string, unknown>;
    const service = row.service as IntegrationService;
    const propertyField = PROPERTY_FIELD[service];

    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        service,
        connectedBy: row.connected_by ?? undefined,
        connectedAt: row.connected_at,
        lastSyncedAt: row.last_synced_at ?? undefined,
        syncStatus: row.sync_status,
        errorMessage: row.error_message ?? undefined,
        needsPropertySetup: propertyField
            ? row.sync_status === 'active' && !credentials[propertyField]
            : false,
    };
}

export async function GET(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const orgId = req.nextUrl.searchParams.get('orgId');

    const authorization = await requireClientOrgMember(clientId, orgId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
        .from('client_integrations')
        .select('id, organization_id, client_id, service, credentials, connected_by, connected_at, last_synced_at, sync_status, error_message')
        .eq('organization_id', authorization.organizationId)
        .eq('client_id', authorization.clientId)
        .order('service');

    if (error) {
        return NextResponse.json({ error: 'Unable to load integrations' }, { status: 500 });
    }

    return NextResponse.json({
        integrations: (data ?? []).map(toSafeIntegration),
    });
}
