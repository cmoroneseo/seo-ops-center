import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { resolvePortalPreview } from './preview-policy';
import type { PortalClientScope } from './session';

/** Authorize staff first, then resolve the canonical client scope. No contact/session writes. */
export async function loadPortalPreview(clientId: string) {
    return resolvePortalPreview(clientId, { authorize: requireClientOrgMember, readScope });
}

async function readScope(clientId: string, organizationId: string): Promise<PortalClientScope | null> {
    const admin = createAdminClient();
    const [clientResult, orgResult] = await Promise.all([
        admin.from('clients').select('id, name, logo_url, launch_date')
            .eq('id', clientId).eq('organization_id', organizationId).maybeSingle(),
        admin.from('organizations').select('name').eq('id', organizationId).maybeSingle(),
    ]);
    if (clientResult.error || orgResult.error) {
        throw new Error('Could not load client preview. Please try again.');
    }
    const client = clientResult.data;
    const org = orgResult.data;
    if (!client || !org) return null;
    const scope: PortalClientScope = {
        clientId, organizationId,
        clientName: String(client.name), organizationName: String(org.name),
        ...(client.logo_url ? { logoUrl: String(client.logo_url) } : {}),
        ...(client.launch_date ? { launchDate: String(client.launch_date).slice(0, 10) } : {}),
    };
    return scope;
}
