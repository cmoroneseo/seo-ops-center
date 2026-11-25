import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { GBP_VIDEO_MIME_TYPES, inspectMp4VideoBuffer, MAX_GBP_VIDEO_BYTES, videoMetadataError } from '@/lib/gbp-approvals/video';
import { createAdminClient } from '@/lib/supabase/admin';
import { json, sqlStatus } from './staff';
import { uuid } from './list';

export function createAssetUpload(dependencies = {
  agencyActor,
  createAdminClient
}) {
  return async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const actor = await dependencies.agencyActor(request);
    if (!actor) return json({ error: 'Unauthorized' }, 401);
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!uuid.test(id) || typeof body?.itemId !== 'string' || !uuid.test(body.itemId)) return json({ error: 'Choose a valid approval item.' }, 400);
    if (body.action && body.action !== 'verify-video') return json({ error: 'Unknown asset action.' }, 400);
    if (body.objectKey) {
      if (typeof body.objectKey !== 'string' || !body.objectKey.startsWith(`approval-assets/${id}/`)
        || !uuid.test(body.objectKey.slice(`approval-assets/${id}/`.length))) return json({ error: 'Asset not found.' }, 404);
      const admin = dependencies.createAdminClient();
      const storage = admin.storage.from('gbp-approval-uploads');
      const asset = await admin.from('approval_assets').select('object_key,organization_id,kind,byte_size,video_verified_at')
        .eq('request_id', id).eq('object_key', body.objectKey).eq('item_id', body.itemId).maybeSingle();
      if (!asset.data || asset.error) return json({ error: 'Asset not found.' }, 404);
      const member = await admin.from('organization_members').select('role').eq('organization_id', asset.data.organization_id).eq('user_id', actor).maybeSingle();
      if (!member.data || member.error || member.data.role === 'viewer') return json({ error: 'Forbidden' }, 403);
      const { object_key: key, kind, byte_size: size, video_verified_at: verified } = asset.data;
      if (body.action === 'verify-video') {
        if (kind !== 'video') return json({ error: 'Choose a video upload.' }, 400);
        if (!verified) {
          const downloaded = await storage.download(key);
          if (downloaded.error || !downloaded.data) return json({ error: 'The uploaded video could not be read. Try again.' }, 503);
          const blob = downloaded.data;
          const result = blob.size !== size
            ? { ok: false as const, error: 'The uploaded size differs from the selected video.' }
            : inspectMp4VideoBuffer(new Uint8Array(await blob.arrayBuffer()));
          if (!result.ok) {
            const removed = await storage.remove([key]);
            if (removed.error) return json({ error: 'The invalid upload could not be removed. Try again.' }, 503);
            const deleted = await admin.from('approval_assets').delete().eq('object_key', key).is('video_verified_at', null);
            if (deleted.error) return json({ error: 'The invalid upload could not be removed. Try again.' }, 503);
            return json({ error: result.error }, 400);
          }
          const marked = await admin.from('approval_assets').update({ video_verified_at: new Date().toISOString() })
            .eq('object_key', key).select('object_key').maybeSingle();
          if (marked.error || !marked.data) return json({ error: 'The upload could not be verified. Try again.' }, 503);
        }
      } else if (kind === 'video' && !verified) {
        return json({ error: 'Verify the uploaded video before previewing it.' }, 400);
      }
      const preview = await storage.createSignedUrl(key, 600);
      if (!preview.data || preview.error) return json({ error: 'Preview unavailable.' }, 503);
      const assetUrl = preview.data.signedUrl;
      return json({ photoUrl: assetUrl, assetUrl, ...(kind === 'video' ? { ok: true, videoUrl: assetUrl } : {}) });
    }

    const kind = body.kind ?? 'mockup';
    const video = kind === 'video';
    const types: readonly string[] = video ? GBP_VIDEO_MIME_TYPES
      : kind === 'video_poster' ? ['image/jpeg'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (!['mockup', 'video', 'video_poster'].includes(kind) || body.action || !types.includes(body.contentType)
      || !Number.isInteger(body.size) || body.size < 1 || body.size > (video ? MAX_GBP_VIDEO_BYTES : 10485760)) {
      return json({ error: video ? 'Choose a nonempty MP4 or MOV video up to 75 MB.' : 'Choose a JPG, PNG or WebP image up to 10 MB.' }, 400);
    }
    if (video && ['durationSeconds', 'width', 'height'].some(field => field in body)) {
      const error = videoMetadataError(body);
      if (error) return json({ error }, 400);
    }
    const admin = dependencies.createAdminClient();
    const { data, error } = await admin.rpc('reserve_approval_asset', {
      p_actor: actor,
      p_request_id: id,
      p_item_id: body.itemId,
      p_kind: kind,
      p_content_type: body.contentType,
      p_size: body.size
    });
    if (error || !data || data.ok === false) return json({ error: video ? 'Video could not be reserved.' : 'Image could not be reserved.' }, sqlStatus(data?.code));
    const signed = await admin.storage.from('gbp-approval-uploads').createSignedUploadUrl(data.objectKey, { upsert: false });
    if (signed.error || !signed.data) return json({ error: 'Upload unavailable.' }, 503);
    return json({ objectKey: data.objectKey, signedUrl: signed.data.signedUrl });
  };
}
