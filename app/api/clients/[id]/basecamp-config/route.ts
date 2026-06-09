import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { cookies } from 'next/headers';

async function getUser() {
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
    return user;
}

/** GET /api/clients/[id]/basecamp-config — returns current Basecamp config */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('clients')
        .select('custom_fields')
        .eq('id', id)
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });

    const cf = (data?.custom_fields as Record<string, unknown>) ?? {};
    return NextResponse.json({
        basecamp_project_id: cf.basecamp_project_id ?? '',
        basecamp_todolist_id: cf.basecamp_todolist_id ?? '',
        basecamp_sync_enabled: cf.basecamp_sync_enabled ?? false,
    });
}

/** POST /api/clients/[id]/basecamp-config — saves Basecamp config to custom_fields */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { basecamp_project_id, basecamp_todolist_id, basecamp_sync_enabled } = body;

    const admin = createAdminClient();

    // Read existing custom_fields + client info for activity log
    const { data: existing } = await admin
        .from('clients')
        .select('custom_fields, name, organization_id')
        .eq('id', id)
        .single();

    const currentFields = (existing?.custom_fields as Record<string, unknown>) ?? {};
    const wasEnabled = !!(currentFields.basecamp_sync_enabled);
    const hadProject = !!(currentFields.basecamp_project_id);

    const updatedFields = {
        ...currentFields,
        basecamp_project_id: basecamp_project_id || null,
        basecamp_todolist_id: basecamp_todolist_id || null,
        basecamp_sync_enabled: !!basecamp_sync_enabled,
    };

    const { error } = await admin
        .from('clients')
        .update({ custom_fields: updatedFields })
        .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Log activity
    if (existing?.organization_id) {
        const isDisabling = wasEnabled && !basecamp_sync_enabled;
        const isFirstConnect = !hadProject && basecamp_project_id;
        const eventType = isDisabling
            ? 'integration.disconnected'
            : isFirstConnect
            ? 'integration.connected'
            : 'integration.reconfigured';

        await logClientActivity({
            organizationId: existing.organization_id,
            clientId: id,
            eventType,
            actorId: user.id,
            metadata: {
                service: 'basecamp',
                basecamp_project_id: basecamp_project_id || null,
                basecamp_todolist_id: basecamp_todolist_id || null,
                sync_enabled: !!basecamp_sync_enabled,
            },
        });
    }

    return NextResponse.json({ success: true });
}
