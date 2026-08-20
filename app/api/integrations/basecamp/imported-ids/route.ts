import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createBasecampImportedIdsGet } from '@/lib/basecamp/imported-ids-route';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/** GET /api/integrations/basecamp/imported-ids?clientId=&organizationId= */
export async function GET(req: NextRequest) {
    const get = createBasecampImportedIdsGet({
        authorizeClient: (clientId, organizationId) => (
            requireClientOrgMember(clientId, organizationId)
        ),
        createReader() {
            const admin = createAdminClient();
            return {
                async listImportedTodoIds(clientId, organizationId) {
                    const { data, error } = await admin
                        .from('tasks')
                        .select('basecamp_todo_id')
                        .eq('client_id', clientId)
                        .eq('organization_id', organizationId)
                        .not('basecamp_todo_id', 'is', null);
                    if (error) throw error;
                    return (data ?? [])
                        .map(row => Number(row.basecamp_todo_id))
                        .filter(id => Number.isSafeInteger(id) && id > 0);
                },
            };
        },
    });

    return get(req);
}
