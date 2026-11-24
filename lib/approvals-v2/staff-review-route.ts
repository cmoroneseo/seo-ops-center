import { z } from 'zod';
import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { versionPhotoPaths } from '@/lib/gbp-approvals/photos';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuid } from './list';
import { canWriteApproval } from './permissions';
import { json, sqlStatus, staffContext, staffLink } from './staff';
import { characterCount, reviewNoteLimit, staffReviewBlockers, staffReviewTags } from './staff-review';

const input = z.object({
  itemId: z.string().regex(uuid),
  versionId: z.string().regex(uuid),
  decision: z.enum(['approved', 'changes_requested']),
  note: z.string().refine(note => !note.includes('\0') && characterCount(note) <= reviewNoteLimit).optional(),
  tags: z.array(z.enum(staffReviewTags)).max(staffReviewTags.length).optional(),
}).strict().refine(body => body.decision !== 'changes_requested' || !!body.note?.trim());

export function createStaffReview(dependencies = { agencyActor, createAdminClient }) {
  return staffLink(async (request, context) => {
    const ctx = await staffContext(request, dependencies);
    if (!ctx) return json({ error: 'Unauthorized', code: 'unauthorized' }, 401);
    if (ctx.unavailable) return json({ error: 'Memberships unavailable.', code: 'unavailable' }, 503);
    if (!ctx.members.some(member => canWriteApproval(member.role))) {
      return json({ error: 'Forbidden', code: 'forbidden' }, 403);
    }
    const { id } = await context.params;
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Invalid review.', code: 'invalid_request' }, 400);

    const { admin, actor, members } = ctx;
    const { decision, note, tags } = parsed.data;
    const itemId = parsed.data.itemId.toLowerCase();
    const versionId = parsed.data.versionId.toLowerCase();
    const target = await admin.from('approval_requests').select('organization_id,stage,archived_at').eq('id', id).maybeSingle();
    if (target.error) return json({ error: 'Review unavailable.', code: 'unavailable' }, 503);
    const orgId = target.data?.organization_id;
    if (!target.data || !orgId || !canWriteApproval(members.find(member => member.organization_id === orgId)?.role)) {
      return json({ error: 'Forbidden', code: 'forbidden' }, 403);
    }
    if (target.data.stage !== 'draft' || target.data.archived_at) {
      return json({ error: 'This request is no longer an active draft.', code: 'not_draft' }, 409);
    }
    const item = await admin.from('approval_items').select('item_type,page_kind,current_version_id')
      .eq('id', itemId).eq('request_id', id).eq('organization_id', orgId).maybeSingle();
    if (item.error) return json({ error: 'Review unavailable.', code: 'unavailable' }, 503);
    if (!item.data) return json({ error: 'Choose an item in this request.', code: 'invalid_request' }, 400);
    if (item.data.current_version_id !== versionId) {
      return json({ error: 'This item has a newer version. Refresh and review it again.', code: 'refresh_required' }, 409);
    }
    if (decision === 'approved') {
      const version = await admin.from('approval_item_versions').select('payload,photo_path,photo_paths')
        .eq('id', versionId).eq('item_id', itemId).eq('request_id', id).eq('organization_id', orgId).maybeSingle();
      if (version.error) return json({ error: 'Review unavailable.', code: 'unavailable' }, 503);
      if (!version.data) return json({ error: 'This version is unavailable.', code: 'refresh_required' }, 409);
      const { payload, photo_path, photo_paths } = version.data;
      const blockers = staffReviewBlockers(item.data.item_type, item.data.page_kind, payload, versionPhotoPaths(photo_paths, photo_path));
      if (blockers.length) return json({ error: blockers.map(blocker => blocker.reason).join(' '), code: 'blocked' }, 400);
    }

    // The RPC rechecks the draft, version and permission under the request lock.
    const result = await admin.rpc('record_approval_staff_review', {
      p_actor: actor, p_request_id: id, p_item_id: itemId, p_version_id: versionId,
      p_decision: decision, p_note: note?.trim() || null, p_tags: tags ?? [],
    });
    if (result.error || !result.data) return json({ error: 'Review unavailable.', code: 'unavailable' }, 503);
    if (result.data.ok !== true) {
      const code: string = result.data.code ?? 'invalid_request';
      return json({ error: sqlStatus(code) === 409 ? 'The draft changed. Refresh and review it again.' : 'The review could not be saved.', code }, sqlStatus(code));
    }
    return json(result.data);
  });
}
