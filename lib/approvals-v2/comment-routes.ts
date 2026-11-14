import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { bearerToken, isBotKeyToken } from '@/lib/bots/scope';
import { staffContext, json, sqlStatus } from './staff';
import { uuid } from './list';
import { applyCommentSuggestion } from './apply-comment';
import { rowAnchor } from './comment-row';
export function createCommentAction(dependencies = { agencyActor, createAdminClient }) {
  return async (request: Request, context: {
    params: Promise<{
      id: string;
      commentId: string;
    }>;
  }) => {
    if (isBotKeyToken(bearerToken(request.headers.get('authorization'))))
      return json({ error: 'Forbidden' }, 403);
    const ctx = await staffContext(request, dependencies);
    if (!ctx)
      return json({ error: 'Unauthorized' }, 401);
    if (ctx.unavailable)
      return json({ error: 'Memberships unavailable.' }, 503);
    const { id, commentId } = await context.params;
    if (!uuid.test(id) || !uuid.test(commentId))
      return json({ error: 'Invalid comment.' }, 400);
    const { admin, actor, members } = ctx;
    const comment = await admin.from('approval_comments').select('*').eq('id', commentId).eq('request_id', id).in('organization_id', members.map(member => member.organization_id)).maybeSingle();
    const c = comment.data;
    if (comment.error || !c)
      return json({ error: 'Comment not found.' }, 404);
    if (!members.some(member => member.organization_id === c.organization_id && ['owner', 'admin', 'member'].includes(member.role)))
      return json({ error: 'Forbidden' }, 403);
    const botActor = await admin.from('approval_bot_actors').select('user_id').eq('user_id', actor).maybeSingle();
    if (botActor.error || botActor.data)
      return json({ error: 'Forbidden' }, 403);
    const body = await request.json().catch(() => null);
    if (!body || !['accept', 'decline', 'resolve', 'reopen', 'reply', 'download'].includes(body.action))
      return json({ error: 'Invalid action.' }, 400);
    const args: Record<string, unknown> = { p_actor: actor, p_comment_id: commentId, p_now: new Date().toISOString() };
    if (body.action === 'download') {
      if (!c.suggested_image_key || !c.suggested_image_key.startsWith(`gbp-approvals/${id}/`))
        return json({ error: 'Image not found.' }, 404);
      const signed = await admin.storage.from('gbp-approval-uploads').createSignedUrl(c.suggested_image_key, 300, { download: true });
      return signed.error ? json({ error: 'Download unavailable.' }, 400) : json({ url: signed.data.signedUrl });
    }
    if (body.action === 'reply') {
      if (c.parent_id || typeof body.reply !== 'string' || !body.reply.trim() || body.reply.length > 2000)
        return json({ error: 'Enter a reply up to 2000 characters.' }, 400);
      const reply = await admin.from('approval_comments').insert({ organization_id: c.organization_id, request_id: id, item_id: c.item_id, version_id: c.version_id, parent_id: c.id, author_kind: 'staff', author_user_id: actor, author_name: 'Marketing Empire Group', anchor_kind: 'page', body: body.reply.trim() });
      return reply.error ? json({ error: 'Reply could not be saved.' }, 400) : json({ ok: true });
    }
    if (body.action === 'accept') {
      if (!c.suggested_text && !c.suggested_image_key)
        return json({ error: 'No suggestion to accept.' }, 400);
      const item = await admin.from('approval_items').select('current_version_id').eq('id', c.item_id).eq('request_id', id).maybeSingle();
      const version = await admin.from('approval_item_versions').select('*').eq('id', item.data?.current_version_id).eq('item_id', c.item_id).maybeSingle();
      if (!version.data)
        return json({ error: 'Draft unavailable.' }, 400);
      try {
        const normalized = applyCommentSuggestion(version.data.payload.body, version.data.outline, rowAnchor(c), c.suggested_text, c.suggested_image_key);
        args.p_payload = { ...version.data.payload, body: normalized.body };
        args.p_photo = c.pin_target === 'mockup' ? c.suggested_image_key : version.data.photo_path;
        args.p_outline = normalized.outline;
        args.p_expected_version_id = version.data.id;
      }
      catch (cause) {
        return json({ error: cause instanceof Error ? cause.message : 'Suggestion could not be applied.' }, 409);
      }
    }
    if (body.action === 'decline') {
      if (body.reply != null && (typeof body.reply !== 'string' || body.reply.length > 2000))
        return json({ error: 'Reply must be up to 2000 characters.' }, 400);
      args.p_reply = body.reply || null;
    }
    const names: Record<string, string> = { accept: 'accept_approval_suggestion', decline: 'decline_approval_suggestion', resolve: 'resolve_approval_comment', reopen: 'reopen_approval_comment' };
    const result = await admin.rpc(names[body.action], args);
    if (result.error || !result.data?.ok)
      return json({ error: 'The comment could not be updated.', code: result.data?.code }, sqlStatus(result.data?.code));
    return json(result.data);
  };
}
