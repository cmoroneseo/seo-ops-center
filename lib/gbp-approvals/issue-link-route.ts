import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateToken, hashToken } from '@/lib/approvals/token';

export function createIssueLink(dependencies: { agencyActor: typeof agencyActor; createAdminClient: typeof createAdminClient }) {
    const { agencyActor, createAdminClient } = dependencies;
    return async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
        const actor = await agencyActor(request);
        if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const { id } = await context.params;
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
        const result = await createAdminClient().rpc('issue_gbp_approval_link', {
            p_actor: actor,
            p_request_id: id,
            p_token_hash: hashToken(token),
            p_expires_at: expiresAt,
            p_now: new Date().toISOString(),
        });
        const value = result.data as { ok?: boolean; code?: string } | null;
        if (result.error || !value || value.ok === false) {
            return Response.json({ error: 'The link could not be updated.', code: value?.code }, { status: value?.code === 'forbidden' ? 403 : 400 });
        }
        return Response.json({ ...value, token, url: `${new URL(request.url).origin}/r/${token}`, expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
    };

}
