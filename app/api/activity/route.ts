import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { logClientActivity, ALLOWED_ACTIVITY_EVENT_TYPES } from '@/lib/supabase/client-activity';
import { ActivityEventType } from '@/lib/types';

/**
 * POST /api/activity
 * Authenticated activity-feed writer. The actor and organization are derived
 * from the session — never from the request body — and access to the target
 * client is enforced by RLS (the anon/session client can only read clients in
 * the caller's organizations). Callers may only set eventType + metadata.
 */
export async function POST(req: NextRequest) {
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
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { clientId?: string; eventType?: string; metadata?: Record<string, unknown> };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { clientId, eventType, metadata } = body;
    if (!clientId || !eventType) {
        return NextResponse.json({ error: 'clientId and eventType are required' }, { status: 400 });
    }
    if (!ALLOWED_ACTIVITY_EVENT_TYPES.has(eventType as ActivityEventType)) {
        return NextResponse.json({ error: `Event type not allowed: ${eventType}` }, { status: 400 });
    }

    // RLS ensures this returns a row only if the user can access the client,
    // which both authorizes the write and gives us the trusted organization_id.
    const { data: client } = await supabase
        .from('clients')
        .select('id, organization_id')
        .eq('id', clientId)
        .single();
    if (!client) {
        return NextResponse.json({ error: 'Client not found or access denied' }, { status: 403 });
    }

    await logClientActivity({
        organizationId: client.organization_id,
        clientId,
        eventType,
        actorId: user.id,
        actorName: user.user_metadata?.full_name || user.email || undefined,
        metadata: metadata ?? {},
    });

    return NextResponse.json({ ok: true });
}
