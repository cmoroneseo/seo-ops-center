import { NextRequest, NextResponse } from 'next/server';
import { mergeIntegrationCredentials, disconnectIntegration } from '@/lib/supabase/integrations';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';

function getString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function readJsonBody(req: NextRequest) {
    try {
        return await req.json();
    } catch {
        return null;
    }
}

/**
 * POST /api/integrations/ahrefs
 * Body: { clientId, orgId?, apiKey?, rankTrackerProjectId? }
 * Either field may be sent alone — credentials are merged, not replaced, so
 * e.g. adding a rank tracker project ID later doesn't drop the API key.
 */
export async function POST(req: NextRequest) {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const clientId = getString((body as Record<string, unknown>).clientId);
    const orgId = getString((body as Record<string, unknown>).orgId);
    const apiKey = getString((body as Record<string, unknown>).apiKey);
    const rankTrackerProjectId = getString((body as Record<string, unknown>).rankTrackerProjectId);

    if (!clientId || (!apiKey && !rankTrackerProjectId)) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    const authorization = await requireClientIntegrationManager(clientId, orgId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const patch: Record<string, unknown> = {};
    if (apiKey) patch.api_key = apiKey;
    if (rankTrackerProjectId) patch.rank_tracker_project_id = rankTrackerProjectId;

    const result = await mergeIntegrationCredentials({
        organizationId: authorization.organizationId,
        clientId: authorization.clientId,
        service: 'ahrefs',
        patch,
        connectedBy: authorization.userId,
    });

    if (!result.success) {
        return NextResponse.json({ error: 'Failed to save Ahrefs integration' }, { status: 500 });
    }

    await logClientActivity({
        organizationId: authorization.organizationId,
        clientId: authorization.clientId,
        eventType: 'integration.connected',
        actorId: authorization.userId,
        actorName: authorization.actorName,
        metadata: { service: 'ahrefs', rankTracker: !!rankTrackerProjectId },
    });

    return NextResponse.json({ success: true });
}

/**
 * DELETE /api/integrations/ahrefs?clientId=...
 */
export async function DELETE(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get('clientId');
    const service = searchParams.get('service');

    if (service && service !== 'ahrefs') {
        return NextResponse.json({ error: 'Invalid service for Ahrefs endpoint' }, { status: 400 });
    }

    const authorization = await requireClientIntegrationManager(clientId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const result = await disconnectIntegration(authorization.clientId, 'ahrefs');
    if (!result.success) {
        return NextResponse.json({ error: 'Failed to disconnect Ahrefs integration' }, { status: 500 });
    }

    await logClientActivity({
        organizationId: authorization.organizationId,
        clientId: authorization.clientId,
        eventType: 'integration.disconnected',
        actorId: authorization.userId,
        actorName: authorization.actorName,
        metadata: { service: 'ahrefs' },
    });

    return NextResponse.json({ success: true });
}
