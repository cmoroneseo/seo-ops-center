import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { parseGbpPostPayload } from '@/lib/gbp-approvals/registry';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const actor = await agencyActor(request);
    if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null) as { taskId?: string; title?: string; dueAt?: string | null; items?: unknown[]; questions?: unknown[] } | null;
    if (body && ['send', 'stage', 'sentAt'].some(key => key in body)) return Response.json({ error: 'Requests must be created as drafts.', code: 'invalid_request' }, { status: 400 });
    if (!body?.taskId || !body.title || !Array.isArray(body.items)) {
        return Response.json({ error: 'Add a title and at least one post.' }, { status: 400 });
    }
    const admin = createAdminClient();
    const task = await admin.from('tasks').select('id, organization_id, client_id').eq('id', body.taskId).maybeSingle();
    if (task.error || !task.data) return Response.json({ error: 'Not found' }, { status: 404 });
    const member = await admin.from('organization_members').select('role').eq('organization_id', task.data.organization_id).eq('user_id', actor).maybeSingle();
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
        p_actor: actor,
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
    return Response.json({ requestId, stage: 'draft', linked: false, reviewUrl: `/approvals/${requestId}` }, { status: 201 });
}
