import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteInventory } from '@/lib/supabase/site-inventory';

export const maxDuration = 30;

export async function GET(request: Request) {
    const clientId = new URL(request.url).searchParams.get('clientId');
    const auth = await requireClientOrgMember(clientId);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    try {
        return Response.json(await getSiteInventory(createAdminClient(), auth.organizationId, auth.clientId));
    } catch {
        console.error('[site-inventory] read failed');
        return Response.json({ error: 'Unable to load site inventory' }, { status: 500 });
    }
}
