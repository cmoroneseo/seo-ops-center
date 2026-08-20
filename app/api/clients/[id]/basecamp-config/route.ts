import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    isBasecampConfigured,
    listBasecampProjects,
    listBasecampTodolists,
} from '@/lib/basecamp/api';
import { createBasecampConfigHandlers } from '@/lib/basecamp/config-route';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { normalizeJsonObject } from '@/lib/basecamp/project-access';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { logClientActivity } from '@/lib/supabase/client-activity';

function handlers() {
    return createBasecampConfigHandlers({
        authorizeClient: clientId => requireClientIntegrationManager(clientId),
        createStore() {
            const admin = createAdminClient();
            return {
                async getClient(clientId, organizationId) {
                    const { data, error } = await admin
                        .from('clients')
                        .select('id, name, organization_id, custom_fields')
                        .eq('id', clientId)
                        .eq('organization_id', organizationId)
                        .maybeSingle();
                    if (error) throw error;
                    if (!data) return null;
                    return {
                        id: data.id,
                        name: data.name,
                        organizationId: data.organization_id,
                        customFields: normalizeJsonObject(data.custom_fields),
                    };
                },
                async updateClientCustomFields(clientId, organizationId, customFields) {
                    const { error } = await admin
                        .from('clients')
                        .update({ custom_fields: customFields })
                        .eq('id', clientId)
                        .eq('organization_id', organizationId);
                    return error?.message ?? null;
                },
                async logActivity(payload) {
                    await logClientActivity({
                        organizationId: payload.organizationId,
                        clientId: payload.clientId,
                        eventType: payload.eventType,
                        actorId: payload.actorId,
                        actorName: payload.actorName,
                        metadata: payload.metadata,
                    });
                },
            };
        },
        createAccessSource: () => createSupabaseBasecampProjectAccessSource(createAdminClient()),
        isConfigured: isBasecampConfigured,
        listProjects: listBasecampProjects,
        listTodolists: projectId => listBasecampTodolists(projectId),
    });
}

/** GET /api/clients/[id]/basecamp-config */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    return handlers().get(req, id);
}

/** POST /api/clients/[id]/basecamp-config */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    return handlers().post(req, id);
}
