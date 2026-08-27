import {
    createImportTasksGet,
    createImportTasksPost,
    type TasksAuthorization,
} from '@/lib/timesheets/import-tasks-route';
import {
    createTaskFromImportEntry,
    loadImportEntryForTask,
    searchClientTasks,
} from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

const dependencies = {
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
