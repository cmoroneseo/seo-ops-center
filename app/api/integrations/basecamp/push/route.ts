import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    isBasecampConfigured,
    listBasecampTodolists,
    getBasecampTodo,
    createBasecampTodo,
    completeBasecampTodo,
    reopenBasecampTodo,
    createBasecampComment,
    updateBasecampTodoAssignees,
    updateBasecampTodoDueDate,
    createBasecampTodoStep,
} from '@/lib/basecamp/api';
import { createBasecampPushPost } from '@/lib/basecamp/push-route';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { normalizeJsonObject } from '@/lib/basecamp/project-access';
import { requireTaskIntegrationManager } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/** POST /api/integrations/basecamp/push */
export async function POST(req: NextRequest) {
    const post = createBasecampPushPost({
        authorizeTask: taskId => requireTaskIntegrationManager(taskId),
        createStore() {
            const admin = createAdminClient();
            return {
                async getTask(taskId, organizationId, clientId) {
                    const { data, error } = await admin
                        .from('tasks')
                        .select('id, organization_id, client_id, title, description, due_date, status, assignee_ids, watcher_ids, basecamp_todo_id, basecamp_project_id, clients(custom_fields)')
                        .eq('id', taskId)
                        .eq('organization_id', organizationId)
                        .eq('client_id', clientId)
                        .maybeSingle();
                    if (error) throw error;
                    if (!data) return null;

                    const clientRelation = Array.isArray(data.clients) ? data.clients[0] : data.clients;
                    const customFields = normalizeJsonObject(clientRelation?.custom_fields);
                    const assigneeIds = Array.isArray(data.assignee_ids)
                        ? data.assignee_ids.filter((id): id is string => typeof id === 'string')
                        : [];
                    const watcherIds = Array.isArray(data.watcher_ids)
                        ? data.watcher_ids.filter((id): id is string => typeof id === 'string')
                        : [];
                    let assigneePersonIds: number[] = [];
                    let completionSubscriberPersonIds: number[] = [];
                    const relevantUserIds = Array.from(new Set([...assigneeIds, ...watcherIds]));
                    if (relevantUserIds.length > 0) {
                        const { data: members, error: memberError } = await admin
                            .from('organization_members')
                            .select('user_id, basecamp_person_id')
                            .eq('organization_id', organizationId)
                            .in('user_id', relevantUserIds);
                        if (memberError) throw memberError;
                        const personIdByUserId = new Map((members ?? []).map(member => [
                            member.user_id,
                            Number(member.basecamp_person_id),
                        ]));
                        assigneePersonIds = assigneeIds
                            .map(id => personIdByUserId.get(id))
                            .filter((id): id is number => (
                                typeof id === 'number' && Number.isSafeInteger(id) && id > 0
                            ));
                        completionSubscriberPersonIds = watcherIds
                            .map(id => personIdByUserId.get(id))
                            .filter((id): id is number => (
                                typeof id === 'number' && Number.isSafeInteger(id) && id > 0
                            ));
                    }

                    return {
                        id: data.id,
                        organizationId: data.organization_id,
                        clientId: data.client_id,
                        title: data.title,
                        description: data.description,
                        dueDate: data.due_date,
                        status: data.status,
                        basecampTodoId: data.basecamp_todo_id,
                        basecampProjectId: data.basecamp_project_id,
                        configuredProjectId: customFields.basecamp_project_id as string | number | null | undefined,
                        configuredTodolistId: customFields.basecamp_todolist_id as string | number | null | undefined,
                        syncEnabled: customFields.basecamp_sync_enabled === true,
                        assigneePersonIds,
                        completionSubscriberPersonIds,
                    };
                },
                async listSubtasks(taskId, organizationId, clientId) {
                    const { data, error } = await admin
                        .from('tasks')
                        .select('id, title, basecamp_todo_id')
                        .eq('parent_task_id', taskId)
                        .eq('organization_id', organizationId)
                        .eq('client_id', clientId)
                        .order('sort_order', { ascending: true });
                    if (error) throw error;
                    return (data ?? []).map(subtask => ({
                        id: subtask.id,
                        title: subtask.title,
                        basecampTodoId: subtask.basecamp_todo_id,
                    }));
                },
                async updateTaskLink(taskId, organizationId, clientId, projectId, todoId, syncedAt) {
                    const { error } = await admin
                        .from('tasks')
                        .update({
                            basecamp_todo_id: Number(todoId),
                            basecamp_project_id: Number(projectId),
                            last_synced_at: syncedAt,
                        })
                        .eq('id', taskId)
                        .eq('organization_id', organizationId)
                        .eq('client_id', clientId);
                    return error?.message ?? null;
                },
                async markTaskSynced(taskId, organizationId, clientId, syncedAt) {
                    const { error } = await admin
                        .from('tasks')
                        .update({ last_synced_at: syncedAt })
                        .eq('id', taskId)
                        .eq('organization_id', organizationId)
                        .eq('client_id', clientId);
                    return error?.message ?? null;
                },
            };
        },
        createAccessSource: () => createSupabaseBasecampProjectAccessSource(createAdminClient()),
        provider: {
            isConfigured: isBasecampConfigured,
            getTodo: (projectId, todoId) => getBasecampTodo(projectId, todoId),
            listTodolists: projectId => listBasecampTodolists(projectId),
            createTodo: (projectId, todolistId, params) => (
                createBasecampTodo(projectId, todolistId, params)
            ),
            createStep: (projectId, parentTodoId, title) => (
                createBasecampTodoStep(projectId, parentTodoId, title)
            ),
            completeTodo: (projectId, todoId) => completeBasecampTodo(projectId, todoId),
            reopenTodo: (projectId, todoId) => reopenBasecampTodo(projectId, todoId),
            createComment: (projectId, todoId, content) => (
                createBasecampComment(projectId, todoId, content)
            ),
            updateTodoDueDate: (projectId, todoId, dueOn) => (
                updateBasecampTodoDueDate(projectId, todoId, dueOn)
            ),
            updateTodoAssignees: (projectId, todoId, personIds) => (
                updateBasecampTodoAssignees(projectId, todoId, personIds)
            ),
        },
        now: () => new Date().toISOString(),
    });

    return post(req);
}
