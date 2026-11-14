import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { signApprovalPhoto } from '@/lib/gbp-approvals/live';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(httpRequest: Request, context: { params: Promise<{ taskId: string }> }) {
    const actor = await agencyActor(httpRequest);
    if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { taskId } = await context.params;
    const admin = createAdminClient();
    const task = await admin.from('tasks').select('id, organization_id, client_id, title, status').eq('id', taskId).maybeSingle();
    if (task.error || !task.data) return Response.json({ error: 'Not found' }, { status: 404 });
    const member = await admin.from('organization_members').select('role').eq('organization_id', task.data.organization_id).eq('user_id', actor).maybeSingle();
    if (member.error || !member.data) return Response.json({ error: 'Forbidden' }, { status: 403 });
    const request = await admin.from('approval_requests').select('id, title, round, due_at').eq('task_id', taskId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (request.error) return Response.json({ error: 'Approvals are not available yet.' }, { status: 503 });
    if (!request.data) return Response.json({ request: null, role: member.data.role });
    const items = await admin.from('approval_items').select('id, position, status, decision_lock_reason, current_version_id').eq('request_id', request.data.id).order('position');
    const link = await admin.from('approval_links').select('expires_at, revoked_at, view_count, last_viewed_at').eq('request_id', request.data.id).maybeSingle();
    const [versions, responses, events] = await Promise.all([
        admin.from('approval_item_versions').select('id, item_id, version_no, payload, photo_path, change_note, source, created_at').eq('request_id', request.data.id).order('version_no', { ascending: false }),
        admin.from('approval_responses').select('id, item_id, version_id, decision, comment, suggested_title, suggested_body, replacement_photo_path, created_at').eq('request_id', request.data.id).order('created_at', { ascending: false }),
        admin.from('approval_events').select('id, item_id, kind, detail, created_at').eq('request_id', request.data.id).order('created_at', { ascending: false }),
    ]);
    if ([items, link, versions, responses, events].some(result => result.error)) {
        return Response.json({ error: 'Approvals could not be loaded.' }, { status: 503 });
    }
    const photos = new Map<string, string | null>();
    for (const path of new Set([
        ...(versions.data ?? []).map(version => version.photo_path),
        ...(responses.data ?? []).map(response => response.replacement_photo_path),
    ].filter((path): path is string => Boolean(path)))) {
        photos.set(path, await signApprovalPhoto(path));
    }
    return Response.json({
        request: request.data,
        items: (items.data ?? []).map(item => ({
            ...item,
            version: (versions.data ?? []).find(version => version.id === item.current_version_id) ?? null,
            response: (responses.data ?? []).find(response => response.item_id === item.id && response.version_id === item.current_version_id) ?? null,
        })),
        versions: (versions.data ?? []).map(version => ({ ...version, photoUrl: photos.get(version.photo_path) ?? null })),
        responses: (responses.data ?? []).map(response => ({ ...response, photoUrl: photos.get(response.replacement_photo_path) ?? null })),
        events: events.data ?? [],
        photos: Object.fromEntries(photos),
        link: link.data ? {
            expiresAt: link.data.expires_at,
            revokedAt: link.data.revoked_at,
            viewCount: link.data.view_count,
            lastViewedAt: link.data.last_viewed_at,
        } : null,
        role: member.data.role,
        taskStatus: task.data.status,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
