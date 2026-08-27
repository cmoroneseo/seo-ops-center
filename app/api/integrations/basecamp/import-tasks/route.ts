import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBasecampTodo, isBasecampConfigured } from '@/lib/basecamp/api';
import { createBasecampImportTasksPost } from '@/lib/basecamp/import-tasks-route';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { membersByBasecampPersonId } from '@/lib/supabase/timesheet-imports';

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
                async logCompletions(payload) {
                    // One event per finished to-do, dated when it was
                    // finished — not when the import ran.
                    for (const completion of payload.completions) {
                        await logClientActivity({
                            organizationId: payload.organizationId,
                            clientId: payload.clientId,
                            eventType: 'task.completed',
                            actorId: payload.actorId,
                            actorName: payload.actorName,
                            occurredAt: completion.completedAt,
                            metadata: { title: completion.title, source: 'basecamp_import' },
                        });
                    }
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
        resolveAssignees: membersByBasecampPersonId,
        now: () => new Date().toISOString(),
    });

    return post(req);
}
