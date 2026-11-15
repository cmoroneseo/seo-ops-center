import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { json, sqlStatus } from './staff';
import { uuid } from './list';
export function createAssetUpload(dependencies = {
  agencyActor,
  createAdminClient
}) {
  return async function POST(request: Request, context: {
    params: Promise<{
      id: string;
    }>;
  }) {
    const actor = await dependencies.agencyActor(request);
    if (!actor) return json({
      error: 'Unauthorized'
    }, 401);
    const {
      id
    } = await context.params;
    const body = await request.json().catch(() => null);
    if (uuid.test(id) && body?.objectKey) {
      const admin = dependencies.createAdminClient();
      const asset = await admin.from('approval_assets').select('object_key,organization_id').eq('request_id', id).eq('object_key', body.objectKey).eq('item_id', body.itemId).maybeSingle();
      if (!asset.data || asset.error) return json({
        error: 'Image not found.'
      }, 404);
      const member = await admin.from('organization_members').select('role').eq('organization_id', asset.data.organization_id).eq('user_id', actor).maybeSingle();
      if (!member.data || member.error || member.data.role === 'viewer') return json({
        error: 'Forbidden'
      }, 403);
      const preview = await admin.storage.from('gbp-approval-uploads').createSignedUrl(asset.data.object_key, 600);
      if (!preview.data || preview.error) return json({
        error: 'Preview unavailable.'
      }, 503);
      return json({
        photoUrl: preview.data.signedUrl
      });
    }
    if (!uuid.test(id) || !body || !uuid.test(body.itemId ?? '') || !['image/jpeg', 'image/png', 'image/webp'].includes(body.contentType) || !Number.isInteger(body.size) || body.size < 1 || body.size > 10485760) return json({
      error: 'Choose a JPG, PNG or WebP image up to 10 MB.'
    }, 400);
    const admin = dependencies.createAdminClient();
    const {
      data,
      error
    } = await admin.rpc('reserve_approval_asset', {
      p_actor: actor,
      p_request_id: id,
      p_item_id: body.itemId,
      p_kind: 'mockup',
      p_content_type: body.contentType,
      p_size: body.size
    });
    if (error || !data || data.ok === false) return json({
      error: 'Image could not be reserved.'
    }, sqlStatus(data?.code));
    const signed = await admin.storage.from('gbp-approval-uploads').createSignedUploadUrl(data.objectKey);
    if (signed.error || !signed.data) return json({
      error: 'Upload unavailable.'
    }, 503);
    return json({
      objectKey: data.objectKey,
      signedUrl: signed.data.signedUrl
    });
  };
}
