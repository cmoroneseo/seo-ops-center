import { hashToken } from '@/lib/approvals/token';
import { verifyReservedImage } from '@/lib/gbp-approvals/images';
import { clientIpHash } from '@/lib/gbp-approvals/live';
import { PUBLIC_REVIEW_HEADERS, publicMessage, publicStatus, submissionHash } from '@/lib/gbp-approvals/public-view';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: PUBLIC_REVIEW_HEADERS });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params;
    if (!token || token.length < 20) return json({ error: publicMessage('not_found') }, 404);
    let body: Record<string, unknown>;
    try {
        const value = await request.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: publicMessage('invalid_request') }, 400);
        body = value as Record<string, unknown>;
    } catch {
        return json({ error: publicMessage('invalid_request') }, 400);
    }
    const respondentName = typeof body.respondentName === 'string' ? body.respondentName : '';
    const respondentEmail = typeof body.respondentEmail === 'string' ? body.respondentEmail : null;
    const displayedVersionIds = Array.isArray(body.displayedVersionIds) ? body.displayedVersionIds.filter((id): id is string => typeof id === 'string') : [];
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    const requested = [...new Set(decisions.flatMap(decision => {
        if (!decision || typeof decision !== 'object') return [];
        const reservationId = (decision as { reservationId?: unknown }).reservationId;
        return typeof reservationId === 'string' ? [reservationId] : [];
    }))];
    if (requested.length > 20) return json({ error: publicMessage('invalid_request') }, 400);
    try {
        const admin = createAdminClient();
        const now = new Date().toISOString();
        const { data: link, error: linkError } = await admin.from('approval_links')
            .select('id, request_id, revoked_at, expires_at').eq('token_hash', hashToken(token)).maybeSingle();
        if (linkError || !link) return json({ error: publicMessage('not_found') }, 404);
        if (link.revoked_at) return json({ error: publicMessage('revoked') }, 410);
        if (link.expires_at <= now) return json({ error: publicMessage('expired') }, 410);
        const verified: string[] = [];
        for (const reservationId of requested) {
            const { data } = await admin.from('approval_upload_reservations').select('id, object_key, content_type, byte_size').eq('id', reservationId)
                .eq('request_id', link.request_id).eq('link_id', link.id).eq('status', 'reserved').gt('expires_at', now).maybeSingle();
            if (!data?.object_key) continue;
            const downloaded = await admin.storage.from('gbp-approval-uploads').download(data.object_key);
            if (downloaded.error || !downloaded.data) continue;
            const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
            if (!await verifyReservedImage(bytes, data.content_type, data.byte_size)) continue;
            verified.push(reservationId);
        }
        const payload = {
            idempotencyKey,
            requestHash: submissionHash({ respondentName, respondentEmail, displayedVersionIds, decisions, answers }),
            respondentName,
            respondentEmail,
            displayedVersionIds,
            decisions,
            answers,
            verifiedReservationIds: verified,
        };
        const { data, error } = await admin.rpc('submit_gbp_approval', {
            p_token_hash: hashToken(token),
            p_payload: payload,
            p_ip_hash: clientIpHash(request),
            p_now: new Date().toISOString(),
        });
        if (error || !data) return json({ error: publicMessage('invalid_request') }, 400);
        const result = data as { ok?: boolean; code?: string };
        if (result.ok === false) return json({ error: publicMessage(result.code ?? 'invalid_request'), code: result.code }, publicStatus(result.code ?? 'invalid_request'));
        return json(result);
    } catch {
        return json({ error: publicMessage('invalid_request') }, 400);
    }
}
