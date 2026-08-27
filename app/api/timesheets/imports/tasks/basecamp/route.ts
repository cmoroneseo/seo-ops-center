import {
    createImportBasecampTaskPost,
} from '@/lib/timesheets/import-basecamp-task-route';
import type { TasksAuthorization } from '@/lib/timesheets/import-tasks-route';
import {
    clientBasecampProjectId,
    findImportedBasecampTask,
    insertImportedTask,
    loadImportEntryForTask,
    membersByBasecampPersonId,
} from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { getBasecampTodo, isBasecampConfigured } from '@/lib/basecamp/api';
import { authorizeBasecampProject } from '@/lib/basecamp/project-access';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';

export const dynamic = 'force-dynamic';

/**
 * POST /api/timesheets/imports/tasks/basecamp
 * Body: { organizationId, timeLogId, basecampTodoId }
 *
 * Imports one Basecamp to-do as a SEO PM task and returns it, so the caller
 * can link the entry through the ordinary task-link patch. The client comes
 * from the time log and the project from that client's config; the to-do is
 * re-verified against the provider before anything is written.
 */
export const POST = createImportBasecampTaskPost({
    async authorize(organizationId: string): Promise<TasksAuthorization> {
        const member = await requireOrganizationMember(organizationId);
        return member.ok
            ? {
                ok: true,
                userId: member.userId,
                organizationId: member.organizationId,
                isManager: member.isManager,
            }
            : { ok: false, status: member.status, error: member.error };
    },
    loadEntry: loadImportEntryForTask,
    resolveClientProjectId: clientBasecampProjectId,
    async authorizeProject({ userId, organizationId, projectId }) {
        const access = await authorizeBasecampProject(
            { userId, organizationId, projectId },
            createSupabaseBasecampProjectAccessSource(createAdminClient()),
        );
        return access.ok;
    },
    isConfigured: isBasecampConfigured,
    getTodo: (projectId, todoId) => getBasecampTodo(projectId, todoId),
    resolveAssignees: membersByBasecampPersonId,
    findImportedTask: findImportedBasecampTask,
    insertTask: insertImportedTask,
    async logImport(payload) {
        await logClientActivity({
            organizationId: payload.organizationId,
            clientId: payload.clientId,
            eventType: 'integration.tasks_imported',
            actorId: payload.actorId,
            metadata: { service: 'basecamp', imported: 1, source: 'timesheet_review', title: payload.title },
        });
    },
    now: () => new Date().toISOString(),
});
