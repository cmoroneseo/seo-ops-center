import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const actor = await agencyActor(request);
    if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { itemId?: string } | null;
    if (!body?.itemId) return Response.json({ error: 'Choose a post.' }, { status: 400 });
    const result = await createAdminClient().rpc('mark_gbp_approval_final', {
        p_actor: actor,
        p_item_id: body.itemId,
        p_request_id: id,
        p_now: new Date().toISOString(),
    });
    if (result.error || !result.data) return Response.json({ error: 'The post could not be marked final.' }, { status: 400 });
    const value = result.data as { ok?: boolean; code?: string };
    if (value.ok === false) return Response.json({ error: 'The post could not be marked final.', code: value.code }, { status: value.code === 'forbidden' ? 403 : 400 });
    return Response.json(value);
}
