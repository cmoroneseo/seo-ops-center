import { NextRequest, NextResponse } from 'next/server';
import { upsertIntegration, disconnectIntegration } from '@/lib/supabase/integrations';
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
 * Body: { clientId, orgId?, apiKey }
 */
export async function POST(req: NextRequest) {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const clientId = getString((body as Record<string, unknown>).clientId);
    const orgId = getString((body as Record<string, unknown>).orgId);
    const apiKey = getString((body as Record<string, unknown>).apiKey);

    if (!clientId || !apiKey) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    const authorization = await requireClientIntegrationManager(clientId, orgId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const result = await upsertIntegration({
        organizationId: authorization.organizationId,
        clientId: authorization.clientId,
        service: 'ahrefs',
        credentials: { api_key: apiKey },
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
        metadata: { service: 'ahrefs' },
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
