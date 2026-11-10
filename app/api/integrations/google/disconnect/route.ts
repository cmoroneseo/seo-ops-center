import { NextRequest, NextResponse } from 'next/server';
import { disconnectIntegration } from '@/lib/supabase/integrations';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import type { IntegrationService } from '@/lib/types';

const GOOGLE_SERVICES = new Set<IntegrationService>(['ga4', 'gsc', 'gbp', 'gtm']);

/**
 * DELETE /api/integrations/google/disconnect?clientId=...&service=ga4|gsc|gbp|gtm
 *
 * Clears the stored grant for one Google service. Tag Manager uses this path
 * because the Ahrefs disconnect route only accepts Ahrefs.
 */
export async function DELETE(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const service = req.nextUrl.searchParams.get('service');
    if (!service || !GOOGLE_SERVICES.has(service as IntegrationService)) {
        return NextResponse.json({ error: 'Invalid service' }, { status: 400 });
    }

    const authorization = await requireClientIntegrationManager(clientId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const result = await disconnectIntegration(authorization.clientId, service as IntegrationService);
    if (!result.success) {
        return NextResponse.json({ error: 'Failed to disconnect the integration' }, { status: 500 });
    }

    await logClientActivity({
        organizationId: authorization.organizationId,
        clientId: authorization.clientId,
        eventType: 'integration.disconnected',
        actorId: authorization.userId,
        actorName: authorization.actorName,
        metadata: { service },
    });

    return NextResponse.json({ success: true });
}
