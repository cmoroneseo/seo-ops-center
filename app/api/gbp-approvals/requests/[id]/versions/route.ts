import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { parseGbpPostPayload } from '@/lib/gbp-approvals/registry';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const actor = await agencyActor(request);
    if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { items?: Array<{ itemId?: string; payload?: unknown; photoPath?: string | null; changeNote?: string; source?: string; sourceResponseId?: string }> } | null;
    if (!body?.items?.length) return Response.json({ error: 'Choose a post to update.' }, { status: 400 });
    const items = [];
    for (const item of body.items) {
        const parsed = parseGbpPostPayload(item.payload);
        if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
        items.push({
            itemId: item.itemId,
            payload: parsed.payload,
            photoPath: item.photoPath ?? null,
            changeNote: item.changeNote ?? '',
            source: item.source ?? 'manual',
            sourceResponseId: item.sourceResponseId ?? null,
        });
    }
    const admin = createAdminClient();
    const result = await admin.rpc('post_gbp_approval_version', {
        p_actor: actor,
        p_request_id: id,
        p_items: items,
        p_now: new Date().toISOString(),
    });
    if (result.error || !result.data) return Response.json({ error: 'The revision could not be saved.' }, { status: 400 });
    const value = result.data as { ok?: boolean; code?: string };
    if (value.ok === false) return Response.json({ error: 'The revision could not be saved.', code: value.code }, { status: value.code === 'forbidden' ? 403 : 400 });
    return Response.json(value);
}
