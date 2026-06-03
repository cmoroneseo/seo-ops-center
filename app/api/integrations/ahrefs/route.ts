import { NextRequest, NextResponse } from 'next/server';
import { upsertIntegration, disconnectIntegration } from '@/lib/supabase/integrations';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function resolveActor() {
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
    return {
        actorId: user?.id,
        actorName: user?.user_metadata?.full_name || user?.email || 'Unknown',
    };
}

/**
 * POST /api/integrations/ahrefs
 * Body: { clientId, orgId, apiKey }
 */
export async function POST(req: NextRequest) {
    const { clientId, orgId, apiKey } = await req.json();

    if (!clientId || !orgId || !apiKey) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    const { actorId, actorName } = await resolveActor();

    const result = await upsertIntegration({
        organizationId: orgId,
        clientId,
        service: 'ahrefs',
        credentials: { api_key: apiKey },
        connectedBy: actorId ?? 'unknown',
    });

    if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await logClientActivity({
        organizationId: orgId,
        clientId,
        eventType: 'integration.connected',
        actorId,
        actorName,
        metadata: { service: 'ahrefs' },
    });

    return NextResponse.json({ success: true });
}

/**
 * DELETE /api/integrations/ahrefs?clientId=...&service=...
 */
export async function DELETE(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get('clientId');
    const service = searchParams.get('service') as 'ga4' | 'gsc' | 'gbp' | 'ahrefs' | null;

    if (!clientId || !service) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    // Look up org before disconnecting
    const admin = createAdminClient();
    const { data: row } = admin
        ? await admin.from('client_integrations').select('organization_id').eq('client_id', clientId).eq('service', service).maybeSingle()
        : { data: null };
    const organizationId = row?.organization_id;

    const result = await disconnectIntegration(clientId, service);
    if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (organizationId) {
        const { actorId, actorName } = await resolveActor();
        await logClientActivity({
            organizationId,
            clientId,
            eventType: 'integration.disconnected',
            actorId,
            actorName,
            metadata: { service },
        });
    }

    return NextResponse.json({ success: true });
}
