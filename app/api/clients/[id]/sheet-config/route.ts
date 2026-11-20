import { createSheetConfigHandlers } from '@/lib/google/sheet-config-route';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';

const columns = 'roadmap_sheet_url, roadmap_sheet_id';

const handlers = createSheetConfigHandlers({
    authorize: requireClientIntegrationManager,
    createStore() {
        const admin = createAdminClient();
        return {
            async get(clientId, organizationId) {
                const { data, error } = await admin.from('clients')
                    .select(columns)
                    .eq('id', clientId)
                    .eq('organization_id', organizationId)
                    .maybeSingle();
                if (error) throw error;
                return data;
            },
            async update(clientId, organizationId, config) {
                const { data, error } = await admin.from('clients')
                    .update(config)
                    .eq('id', clientId)
                    .eq('organization_id', organizationId)
                    .select(columns)
                    .maybeSingle();
                if (error) throw error;
                return data;
            },
        };
    },
    logActivity: logClientActivity,
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    return handlers.get((await params).id);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    return handlers.post(request, (await params).id);
}
