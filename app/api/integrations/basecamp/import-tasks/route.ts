import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBasecampTodo, isBasecampConfigured } from '@/lib/basecamp/api';
import { createBasecampImportTasksPost } from '@/lib/basecamp/import-tasks-route';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { logClientActivity } from '@/lib/supabase/client-activity';

export const dynamic = 'force-dynamic';

/** POST /api/integrations/basecamp/import-tasks */
export async function POST(req: NextRequest) {
    const post = createBasecampImportTasksPost({
        authorizeClient: (clientId, organizationId) => (
            requireClientOrgMember(clientId, organizationId)
        ),
        createAccessSource: () => createSupabaseBasecampProjectAccessSource(createAdminClient()),
        isConfigured: isBasecampConfigured,
        getTodo: (projectId, todoId) => getBasecampTodo(projectId, todoId),
        createWriter() {
            const admin = createAdminClient();
            return {
                async insertTasks(rows) {
                    const { error } = await admin.from('tasks').insert(rows);
                    return error?.message ?? null;
                },
                async logActivity(payload) {
                    await logClientActivity({
                        organizationId: payload.organizationId,
                        clientId: payload.clientId,
                        eventType: 'integration.tasks_imported',
                        actorId: payload.actorId,
                        actorName: payload.actorName,
                        metadata: {
                            service: 'basecamp',
                            imported: payload.imported,
                            errors: payload.errors,
                        },
                    });
                },
            };
        },
        now: () => new Date().toISOString(),
    });

    return post(req);
}
