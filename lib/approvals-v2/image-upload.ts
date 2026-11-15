import { hashToken } from '@/lib/approvals/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_REVIEW_HEADERS, publicStatus } from '@/lib/gbp-approvals/public-view';
import { replacementPreview, replacementTypes } from './replacement-images';
import { uuid } from './list';
export function createImageUpload(complete = false, dependencies = { createAdminClient }) {
  return async (request: Request, context: {
    params: Promise<{
      token: string;
      reservationId?: string;
    }>;
  }) => {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: PUBLIC_REVIEW_HEADERS });
    const { token, reservationId } = await context.params;
    if (token.length < 20 || token.length > 500)
      return json({ error: 'Review not found.' }, 404);
    try {
      const admin = dependencies.createAdminClient();
      const now = new Date().toISOString();
      const body = await request.json();
      if (!complete) {
        if (!uuid.test(body.itemId) || !uuid.test(body.versionId) || !replacementTypes.includes(body.contentType) || !Number.isInteger(body.byteSize) || body.byteSize < 1 || body.byteSize > 15728640)
          return json({ error: 'JPG, PNG, WebP or HEIC, up to 15 MB' }, 400);
        const { data, error } = await admin.rpc('reserve_approval_image_upload', {
          p_token_hash: hashToken(token),
          p_item_id: body.itemId,
          p_version_id: body.versionId,
          p_content_type: body.contentType,
          p_size: body.byteSize,
          p_now: now
        });
        if (error || !data?.ok)
          return json({ error: 'Upload could not be reserved.', code: data?.code }, publicStatus(data?.code ?? 'invalid_request'));
        const signed = await admin.storage.from('gbp-approval-uploads').createSignedUploadUrl(data.objectKey);
        if (signed.error || !signed.data)
          return json({ error: 'Upload could not be reserved.' }, 400);
        return json({ reservationId: data.reservationId, signedUrl: signed.data.signedUrl });
      }
      if (!reservationId || !uuid.test(reservationId))
        return json({ error: 'Upload not found.' }, 404);
      // Reuse the released-item gate, including its public read rate limit.
      const gate = await admin.rpc('get_approval_item_by_token', { p_token_hash: hashToken(token), p_item_id: body.itemId, p_now: now });
      if (gate.error || !gate.data?.ok || !gate.data.version?.id)
        return json({ error: 'Review unavailable.' }, publicStatus(gate.data?.code ?? gate.data?.state ?? 'not_found'));
      const link = await admin.from('approval_links').select('id,request_id').eq('token_hash', hashToken(token)).maybeSingle();
      if (!link.data)
        return json({ error: 'Upload not found.' }, 404);
      const reservation = await admin.from('approval_upload_reservations').select('*').eq('id', reservationId).eq('link_id', link.data.id).eq('request_id', link.data.request_id).eq('item_id', body.itemId).eq('version_id', gate.data.version.id).eq('purpose', 'image_replacement').eq('status', 'reserved').gt('expires_at', now).maybeSingle();
      const row = reservation.data;
      if (reservation.error || !row)
        return json({ error: 'Upload not found.' }, 404);
      const bucket = admin.storage.from('gbp-approval-uploads');
      if (!row.preview_key) {
        const original = await bucket.download(row.object_key);
        if (original.error || !original.data || original.data.size > 15728640)
          return json({ error: 'Upload unavailable.' }, 400);
        const preview = await replacementPreview(new Uint8Array(await original.data.arrayBuffer()), row.content_type, row.byte_size);
        const previewKey = `${row.object_key}.preview.jpg`;
        const stored = await bucket.upload(previewKey, preview, { contentType: 'image/jpeg', upsert: true });
        if (stored.error)
          return json({ error: 'Preview could not be saved.' }, 400);
        const saved = await admin.rpc('set_approval_upload_preview', { p_reservation_id: row.id, p_preview_key: previewKey });
        if (saved.error || !saved.data?.ok)
          return json({ error: 'Preview could not be saved.' }, 400);
        row.preview_key = previewKey;
      }
      const signed = await bucket.createSignedUrl(row.preview_key, 900);
      if (signed.error || !signed.data)
        return json({ error: 'Preview unavailable.' }, 400);
      return json({ previewUrl: signed.data.signedUrl });
    }
    catch (error) {
      console.error('approval image upload failed', error instanceof Error ? error.message : error);
      return json({ error: 'This image could not be processed. Choose a JPG, PNG, WebP or HEIC, up to 15 MB.' }, 400);
    }
  };
}
