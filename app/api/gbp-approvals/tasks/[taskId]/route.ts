import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

async function actor() {
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
    const { data } = await supabase.auth.getUser();
    return data.user;
}

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await actor();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { taskId } = await context.params;
    const admin = createAdminClient();
    const task = await admin.from('tasks').select('id, organization_id, client_id, title, status').eq('id', taskId).maybeSingle();
    if (task.error || !task.data) return Response.json({ error: 'Not found' }, { status: 404 });
    const member = await admin.from('organization_members').select('role').eq('organization_id', task.data.organization_id).eq('user_id', user.id).maybeSingle();
    if (member.error || !member.data) return Response.json({ error: 'Forbidden' }, { status: 403 });
    const request = await admin.from('approval_requests').select('id, title, round, due_at').eq('task_id', taskId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (request.error) return Response.json({ error: 'Approvals are not available yet.' }, { status: 503 });
    if (!request.data) return Response.json({ request: null, role: member.data.role });
    const items = await admin.from('approval_items').select('id, position, status, decision_lock_reason').eq('request_id', request.data.id).order('position');
    const link = await admin.from('approval_links').select('expires_at, revoked_at, view_count, last_viewed_at').eq('request_id', request.data.id).maybeSingle();
    return Response.json({
        request: request.data,
        items: items.data ?? [],
        link: link.data ? {
            expiresAt: link.data.expires_at,
            revokedAt: link.data.revoked_at,
            viewCount: link.data.view_count,
            lastViewedAt: link.data.last_viewed_at,
        } : null,
        role: member.data.role,
        taskStatus: task.data.status,
    });
}
