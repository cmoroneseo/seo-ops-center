import { safeClientLogoUrl } from './client-logo';
import { createHash } from 'node:crypto';
import { carryAnchor } from './carry';
import { rowAnchor } from './comment-row';
import { sanitizeDoc } from './page-doc';
import { imagePaths } from './page-body';
import { staffContext, json } from './staff';
import { linkState, uuid } from './list';
import { canSendApproval, sendPermissionReason } from './permissions';
import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ReviewDecision } from '@/lib/internal-review/model';
import { signApprovalPhoto } from '@/lib/gbp-approvals/live';
export function createStaffDetail(dependencies = {
  agencyActor,
  createAdminClient,
  signApprovalPhoto
}) {
  return async function GET(request: Request, context: {
    params: Promise<{
      id: string;
    }>;
  }) {
    const ctx = await staffContext(request, dependencies);
    if (!ctx) return json({
      error: 'Unauthorized',
      code: 'unauthorized'
    }, 401);
    if (ctx.unavailable) return json({
      error: 'Memberships unavailable.',
      code: 'unavailable'
    }, 503);
    const {
      id
    } = await context.params;
    if (!uuid.test(id)) return json({
      error: 'Invalid request ID.',
      code: 'invalid_request'
    }, 400);
    const {
      admin,
      actor,
      members
    } = ctx;
    const result = await admin.from('approval_requests').select('*,clients!approval_requests_client_id_fkey(id,name,domain,logo_url,account_manager_id),owner:users!approval_requests_owner_id_fkey(id,full_name),bot_api_keys!approval_requests_bot_key_id_fkey(name)').eq('id', id).in('organization_id', members.map(m => m.organization_id)).maybeSingle();
    if (result.error) return json({
      error: 'Approvals could not be loaded.'
    }, 503);
    if (!result.data) return json({
      error: 'Not found',
      code: 'not_found'
    }, 404);
    const r = result.data;
    if (r.clients) r.clients.logo_url = safeClientLogoUrl(r.clients.logo_url);
    const [items, versions, responses, questions, events, link, comments, uploads, feedback] = await Promise.all([
      admin.from('approval_items').select('*').eq('request_id', id).order('position'),
      admin.from('approval_item_versions').select('*').eq('request_id', id)
        .order('version_no', { ascending: false }),
      admin.from('approval_responses').select('*').eq('request_id', id)
        .order('created_at', { ascending: false }),
      admin.from('approval_questions').select('*').eq('request_id', id).order('position'),
      admin.from('approval_events').select('*').eq('request_id', id)
        .order('created_at', { ascending: false }),
      admin.from('approval_links')
        .select('created_at,expires_at,revoked_at,last_viewed_at,view_count')
        .eq('request_id', id).maybeSingle(),
      admin.from('approval_comments').select('*').eq('request_id', id).order('created_at'),
      admin.from('approval_upload_reservations').select('object_key,preview_key').eq('request_id', id).eq('purpose', 'image_replacement'),
      r.item_type === 'gbp_post' ? admin.from('approval_internal_feedback')
        .select('id,item_id,version_id,reviewer_name,decision,comment')
        .eq('organization_id', r.organization_id).eq('request_id', id).order('created_at').order('id') : null,
    ]);
    if ([items, versions, responses, questions, events, link, comments, uploads].some(v => v.error)) return json({
      error: 'Approvals could not be loaded.'
    }, 503);
    const paths = [...new Set([...(versions.data ?? []).map(v => v.photo_path), ...(responses.data ?? []).map(response => response.replacement_photo_path)].filter((path): path is string => Boolean(path)))];
    if (r.item_type === 'page') {
      for (const version of versions.data ?? []) {
        try {
          paths.push(...imagePaths((version.payload as { body: unknown }).body));
        } catch {
          // An invalid historical body must not prevent staff opening the request.
        }
      }
    }
    for (const upload of uploads.data ?? []) {
      if (upload.preview_key) paths.push(upload.preview_key);
    }
    const scopedPaths = [...new Set(paths)].filter(path => path.startsWith('https://') || ['approval-assets', 'gbp-approvals'].some(prefix => path.startsWith(`${prefix}/${id}/`)));
    const photos = Object.fromEntries(await Promise.all(scopedPaths.map(async path => [path, await dependencies.signApprovalPhoto(uploads.data?.find(upload => upload.object_key === path)?.preview_key ?? path)])));
    const role = members.find(m => m.organization_id === r.organization_id)?.role;
    const client = r.clients as {
      account_manager_id?: string;
    } | null;
    const botActor = await admin.from('approval_bot_actors').select('user_id').eq('user_id', actor).maybeSingle();
    const canSend = canSendApproval(role, actor, client?.account_manager_id, !!botActor.error || !!botActor.data);
    return json({
      request: r,
      items: (items.data ?? []).map(item => ({
        ...item,
        version: versions.data?.find(v => v.id === item.current_version_id) ?? null,
        releasedVersion: versions.data?.find(v => v.id === item.released_version_id) ?? null,
        response: responses.data?.find(v => v.item_id === item.id && v.version_id === (r.stage === 'sent' ? item.released_version_id : item.current_version_id)) ?? null
      })),
      internalFeedbackUnavailable: !!feedback?.error,
      internalFeedback: (feedback?.data ?? []).map(entry => ({
        id: entry.id,
        itemId: entry.item_id,
        versionNo: versions.data?.find(version => version.id === entry.version_id)?.version_no ?? null,
        reviewerName: entry.reviewer_name,
        decision: entry.decision as ReviewDecision,
        comment: entry.comment,
      })),
      comments: (comments.data ?? []).map(comment => {
        const item = items.data?.find(item => item.id === comment.item_id);
        const version = versions.data?.find(version => version.id === item?.released_version_id);
        let state = 'same';
        let carryBlockId = comment.block_id;
        if (r.item_type === 'page' && version && !comment.parent_id) {
          const carried = carryAnchor(rowAnchor(comment), sanitizeDoc(version.payload.body), version.outline ?? [], version.photo_path ? createHash('sha256').update(version.photo_path).digest('hex') : undefined, versions.data?.find(version => version.id === comment.version_id)?.outline ?? []);
          state = carried.state;
          carryBlockId = carried.blockId;
        }
        return { ...comment, state, carryBlockId, versionNo: versions.data?.find(version => version.id === comment.version_id)?.version_no, addressedVersion: versions.data?.find(version => version.id === comment.resolved_in_version_id)?.version_no, previewUrl: photos[uploads.data?.find(upload => upload.object_key === comment.suggested_image_key)?.preview_key ?? ''] ?? null };
      }),
      versions: versions.data,
      responses: responses.data,
      questions: questions.data,
      events: events.data,
      photos,
      link: link.data ? {
        state: linkState(link.data),
        expiresAt: link.data.expires_at,
        createdAt: link.data.created_at,
        revokedAt: link.data.revoked_at,
        openedAt: link.data.last_viewed_at,
        viewCount: link.data.view_count
      } : null,
      owner: r.owner,
      createdVia: r.created_via,
      botName: (r.bot_api_keys as {
        name: string;
      } | null)?.name ?? null,
      canSend,
      canWrite: ['owner', 'admin', 'member'].includes(role ?? ''),
      sendReason: canSend ? null : sendPermissionReason,
      actorId: actor
    });
  };
}
export const GET = createStaffDetail();
