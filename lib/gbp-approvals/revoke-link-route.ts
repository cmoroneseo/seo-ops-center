import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';

export function createRevokeLink(dependencies: { agencyActor: typeof agencyActor; createAdminClient: typeof createAdminClient }) {
    const { agencyActor, createAdminClient } = dependencies;
    return async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
        const actor = await agencyActor(request);
        if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const { id } = await context.params;
        const result = await createAdminClient().rpc('revoke_gbp_approval_link', {
            p_actor: actor,
            p_request_id: id,
            p_now: new Date().toISOString(),
        });
        const value = result.data as { ok?: boolean; code?: string } | null;
        if (result.error || !value || value.ok === false) {
            return Response.json({ error: 'The link could not be updated.', code: value?.code }, { status: value?.code === 'forbidden' ? 403 : 400 });
        }
        return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
    };

}
