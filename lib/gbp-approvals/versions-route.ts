import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { parseGbpPhotoPaths, parseGbpPostPayload } from '@/lib/gbp-approvals/registry';
import { gbpMediaError } from '@/lib/gbp-approvals/video';
import { createAdminClient } from '@/lib/supabase/admin';

export function createGbpVersionPost(dependencies = { agencyActor, createAdminClient }) {
    return async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
        const actor = await dependencies.agencyActor(request);
        if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const { id } = await context.params;
        const body = await request.json().catch(() => null) as { items?: Array<{ itemId?: string; payload?: unknown; photoPath?: string | null; photoPaths?: unknown; videoPath?: unknown; videoPosterPath?: unknown; expectedVersionId?: string; changeNote?: string; source?: string; sourceResponseId?: string }> } | null;
        if (!Array.isArray(body?.items) || !body.items.length || body.items.length > 30) return Response.json({ error: 'Choose a post to update.' }, { status: 400 });
        const items = [];
        for (const item of body.items) {
            if (!item || typeof item !== 'object') return Response.json({ error: 'Invalid item.' }, { status: 400 });
            const parsed = parseGbpPostPayload(item.payload);
            if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
            const photoPaths = 'photoPaths' in item ? parseGbpPhotoPaths(item.photoPaths) : undefined;
            const mediaError = gbpMediaError(item);
            if (mediaError) return Response.json({ error: mediaError }, { status: 400 });
            items.push({
                itemId: item.itemId,
                payload: parsed.payload,
                photoPath: item.photoPath ?? null,
                ...(photoPaths ? { photoPaths } : {}),
                ...('videoPath' in item ? { videoPath: item.videoPath } : {}),
                ...('videoPosterPath' in item ? { videoPosterPath: item.videoPosterPath } : {}),
                ...(item.expectedVersionId ? { expectedVersionId: item.expectedVersionId } : {}),
                changeNote: item.changeNote ?? '',
                source: item.source ?? 'manual',
                sourceResponseId: item.sourceResponseId ?? null,
            });
        }
        const admin = dependencies.createAdminClient();
        const result = await admin.rpc('post_gbp_approval_version', {
            p_actor: actor,
            p_request_id: id,
            p_items: items,
            p_now: new Date().toISOString(),
        });
        if (result.error || !result.data) return Response.json({ error: 'The revision could not be saved.' }, { status: 400 });
        const value = result.data as { ok?: boolean; code?: string };
        if (value.ok === false) return Response.json({ error: 'The revision could not be saved.', code: value.code }, { status: value.code === 'forbidden' ? 403 : value.code === 'conflict' ? 409 : 400 });
        return Response.json(value);
    };
}
