import {
    createImportTasksGet,
    createImportTasksPost,
    type ImportTasksDependencies,
    type TasksAuthorization,
} from '@/lib/timesheets/import-tasks-route';
import {
    clientBasecampProjectId,
    createTaskFromImportEntry,
    listImportedBasecampTodoIds,
    loadImportEntryForTask,
    searchClientTasks,
} from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { isBasecampConfigured, listAllBasecampProjectTodos } from '@/lib/basecamp/api';
import { authorizeBasecampProject } from '@/lib/basecamp/project-access';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const dependencies: ImportTasksDependencies = {
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
    searchTasks: searchClientTasks,
    loadEntry: loadImportEntryForTask,
    createTask: createTaskFromImportEntry,
    /**
     * The Basecamp half of the picker. The project is resolved from the
     * CLIENT, never from the request, and then run through the same project
     * entitlement boundary every other Basecamp operation crosses.
     */
    basecamp: {
        resolveClientProjectId: clientBasecampProjectId,
        async authorizeProject({ userId, organizationId, projectId }) {
            const access = await authorizeBasecampProject(
                { userId, organizationId, projectId },
                createSupabaseBasecampProjectAccessSource(createAdminClient()),
            );
            return access.ok;
        },
        isConfigured: isBasecampConfigured,
        async listProjectTodos(projectId) {
            const todos = await listAllBasecampProjectTodos(projectId, true);
            return todos.map(todo => ({
                id: String(todo.id),
                title: (todo.title ?? '').trim(),
                completed: todo.completed === true,
                dueOn: todo.due_on ?? null,
                todolistTitle: todo.todolistTitle,
                projectId: String(projectId),
            })).filter(todo => todo.title.length > 0);
        },
        listImportedTodoIds: listImportedBasecampTodoIds,
    },
};

/** GET /api/timesheets/imports/tasks?organizationId=&clientId=&q= */
export const GET = createImportTasksGet(dependencies);

/**
 * POST /api/timesheets/imports/tasks
 * Body: { organizationId, timeLogId, title, assigneeUserId? }
 *
 * Creates the task server-side so the client is derived from the time log
 * rather than trusted from the body. The Basecamp to-do is then pushed by the
 * caller through the existing `/api/integrations/basecamp/push` endpoint —
 * that route already resolves the project, the todolist and the assignee
 * person ids from the task and its client config, so nothing about Basecamp
 * is reimplemented here.
 */
export const POST = createImportTasksPost(dependencies);
