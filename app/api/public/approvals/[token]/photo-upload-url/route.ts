import { hashToken } from '@/lib/approvals/token';
import { PUBLIC_REVIEW_HEADERS, publicMessage, publicStatus } from '@/lib/gbp-approvals/public-view';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: PUBLIC_REVIEW_HEADERS });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params;
    if (!token || token.length < 20) return json({ error: publicMessage('not_found') }, 404);
    let contentType = '';
    let byteSize = 0;
    try {
        const body = await request.json() as { contentType?: unknown; byteSize?: unknown };
        contentType = typeof body.contentType === 'string' ? body.contentType : '';
        byteSize = typeof body.byteSize === 'number' ? body.byteSize : 0;
    } catch {
        return json({ error: publicMessage('invalid_request') }, 400);
    }
    try {
        const admin = createAdminClient();
        const { data, error } = await admin.rpc('reserve_gbp_approval_upload', {
            p_token_hash: hashToken(token),
            p_content_type: contentType,
            p_byte_size: byteSize,
            p_now: new Date().toISOString(),
        });
        if (error || !data) return json({ error: publicMessage('invalid_request') }, 400);
        const result = data as { ok?: boolean; code?: string; objectKey?: string; reservationId?: string };
        if (result.ok === false || !result.objectKey) {
            return json({ error: publicMessage(result.code ?? 'invalid_request'), code: result.code }, publicStatus(result.code ?? 'invalid_request'));
        }
        const signed = await admin.storage.from('gbp-approval-uploads').createSignedUploadUrl(result.objectKey);
        if (signed.error || !signed.data) return json({ error: publicMessage('invalid_request') }, 400);
        return json({ reservationId: result.reservationId, signedUrl: signed.data.signedUrl, token: signed.data.token });
    } catch {
        return json({ error: publicMessage('invalid_request') }, 400);
    }
}
