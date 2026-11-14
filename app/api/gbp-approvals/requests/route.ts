import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { generateToken, hashToken } from '@/lib/approvals/token';
import { parseGbpPostPayload } from '@/lib/gbp-approvals/registry';
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

export async function POST(request: Request) {
    const user = await actor();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null) as { taskId?: string; title?: string; dueAt?: string | null; items?: unknown[]; questions?: unknown[] } | null;
    if (!body?.taskId || !body.title || !Array.isArray(body.items)) {
        return Response.json({ error: 'Add a title and at least one post.' }, { status: 400 });
    }
    const admin = createAdminClient();
    const task = await admin.from('tasks').select('id, organization_id, client_id').eq('id', body.taskId).maybeSingle();
    if (task.error || !task.data) return Response.json({ error: 'Not found' }, { status: 404 });
    const member = await admin.from('organization_members').select('role').eq('organization_id', task.data.organization_id).eq('user_id', user.id).maybeSingle();
    if (!member.data || member.data.role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const items = [];
    for (const entry of body.items) {
        if (!entry || typeof entry !== 'object') return Response.json({ error: 'Each post needs a payload.' }, { status: 400 });
        const item = entry as { position?: number; payload?: unknown; photoPath?: string | null };
        const parsed = parseGbpPostPayload(item.payload);
        if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
        items.push({ position: item.position, payload: parsed.payload, photoPath: item.photoPath ?? null });
    }
    const created = await admin.rpc('create_gbp_approval_request', {
        p_actor: user.id,
        p_organization_id: task.data.organization_id,
        p_client_id: task.data.client_id,
        p_task_id: task.data.id,
        p_title: body.title,
        p_due_at: body.dueAt ?? null,
        p_questions: body.questions ?? [],
        p_items: items,
    });
    if (created.error || !created.data || (created.data as { ok?: boolean }).ok === false) {
        return Response.json({ error: 'The approval could not be saved.' }, { status: 400 });
    }
    const requestId = (created.data as { requestId: string }).requestId;
    const token = generateToken();
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const link = await admin.rpc('issue_gbp_approval_link', {
        p_actor: user.id,
        p_request_id: requestId,
        p_token_hash: hashToken(token),
        p_expires_at: expires,
        p_now: new Date().toISOString(),
    });
    if (link.error || !link.data || (link.data as { ok?: boolean }).ok === false) {
        return Response.json({ requestId, error: 'The request was saved, but the link was not.' }, { status: 500 });
    }
    const origin = new URL(request.url).origin;
    return Response.json({ requestId, url: `${origin}/r/${token}`, expiresAt: expires });
}
