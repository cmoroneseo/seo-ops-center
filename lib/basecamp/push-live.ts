import { createAdminClient } from '../supabase/admin.ts';
import {
    isBasecampConfigured,
    listBasecampTodolists,
    getBasecampTodo,
    createBasecampTodo,
    completeBasecampTodo,
    reopenBasecampTodo,
    completeBasecampStep,
    reopenBasecampStep,
    getBasecampRecording,
    createBasecampComment,
    updateBasecampTodoAssignees,
    updateBasecampTodoDueDate,
    createBasecampTodoStep,
    basecampSubtaskSupport,
    findProjectTimesheetRecordingId,
    listBasecampProjectTimesheetEntries,
    createBasecampTimesheetEntry,
    deleteBasecampTimesheetEntry,
} from './api.ts';
import { rehomeProjectTimesheetEntries } from './rehome-timesheet.ts';
import { createBasecampPushPost } from './push-route.ts';
import { createSupabaseBasecampProjectAccessSource } from './supabase-project-access-source.ts';
import { normalizeJsonObject } from './project-access.ts';
import { seoPlanPushTodolistId } from './plan-lists.ts';
import { classifyBasecampRecording, completableRecordingKind } from '../seo-plan/basecamp-nest.ts';

type AuthorizeTask = Parameters<typeof createBasecampPushPost>[0]['authorizeTask'];

/**
 * The to-do push the task drawer uses. Callers supply who is allowed to push.
 * The store, the SEO Plan list, and the Basecamp client stay here so a bot
 * cannot grow a second copy.
 */
export function createLiveBasecampPushPost(authorizeTask: AuthorizeTask) {
    return createBasecampPushPost({
        authorizeTask,
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
                        configuredTodolistId: seoPlanPushTodolistId(customFields),
                        syncEnabled: customFields.basecamp_sync_enabled === true,
                        assigneePersonIds,
                        completionSubscriberPersonIds,
                    };
                },
                async listSubtasks(taskId, organizationId, clientId) {
                    const { data, error } = await admin
                        .from('tasks')
                        .select('id, title, status, basecamp_todo_id')
                        .eq('parent_task_id', taskId)
                        .eq('organization_id', organizationId)
                        .eq('client_id', clientId)
                        .order('sort_order', { ascending: true });
                    if (error) throw error;
                    return (data ?? []).map(subtask => ({
                        id: subtask.id,
                        title: subtask.title,
                        status: subtask.status,
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
        async rehomeProjectTime({ taskId, organizationId, projectId, todoId }) {
            const admin = createAdminClient();
            return rehomeProjectTimesheetEntries({ taskId, organizationId, projectId, todoId }, {
                async listLogs(candidateTaskId, candidateOrganizationId) {
                    const { data, error } = await admin
                        .from('time_logs')
                        .select('id, date, hours, description, basecamp_entry_id, basecamp_recording_id, user_id')
                        .eq('task_id', candidateTaskId)
                        .eq('organization_id', candidateOrganizationId)
                        .eq('status', 'logged')
                        .is('voided_at', null);
                    if (error) throw error;
                    const userIds = [...new Set((data ?? [])
                        .map(row => row.user_id)
                        .filter((id): id is string => typeof id === 'string'))];
                    const personByUser = new Map<string, number>();
                    if (userIds.length > 0) {
                        const { data: members, error: memberError } = await admin
                            .from('organization_members')
                            .select('user_id, basecamp_person_id')
                            .eq('organization_id', candidateOrganizationId)
                            .in('user_id', userIds);
                        if (memberError) throw memberError;
                        for (const member of members ?? []) {
                            const personId = Number(member.basecamp_person_id);
                            if (Number.isSafeInteger(personId) && personId > 0) {
                                personByUser.set(member.user_id, personId);
                            }
                        }
                    }
                    return (data ?? []).map(row => {
                        const personId = typeof row.user_id === 'string' ? personByUser.get(row.user_id) ?? null : null;
                        return {
                            id: row.id,
                            entryId: row.basecamp_entry_id == null ? null : String(row.basecamp_entry_id),
                            recordingId: row.basecamp_recording_id == null ? null : String(row.basecamp_recording_id),
                            date: String(row.date),
                            hours: Number(row.hours),
                            description: typeof row.description === 'string' ? row.description : null,
                            personId,
                        };
                    });
                },
                async projectTimesheetRecordingId(candidateProjectId) {
                    const recordingId = await findProjectTimesheetRecordingId(candidateProjectId);
                    return recordingId == null ? null : String(recordingId);
                },
                async listEntries(candidateProjectId) {
                    const entries = await listBasecampProjectTimesheetEntries(candidateProjectId);
                    return entries.map(entry => ({
                        id: entry.id,
                        date: entry.date,
                        hours: entry.hours,
                        description: entry.description,
                        parent: entry.parent,
                    }));
                },
                async claimedEntryIds(candidateOrganizationId, entryIds) {
                    const ids = entryIds.map(id => Number(id)).filter(id => Number.isSafeInteger(id));
                    if (ids.length === 0) return [];
                    const { data, error } = await admin
                        .from('time_logs')
                        .select('basecamp_entry_id')
                        .eq('organization_id', candidateOrganizationId)
                        .in('basecamp_entry_id', ids);
                    if (error) throw error;
                    return (data ?? []).map(row => row.basecamp_entry_id);
                },
                async createEntry(recordingId, fields) {
                    return createBasecampTimesheetEntry(recordingId, fields);
                },
                deleteEntry: entryId => deleteBasecampTimesheetEntry(entryId),
                async saveLink(saved) {
                    let query = admin
                        .from('time_logs')
                        .update({
                            basecamp_entry_id: Number(saved.entryId),
                            basecamp_recording_id: Number(saved.recordingId),
                            basecamp_project_id: Number(saved.projectId),
                            basecamp_synced_at: new Date().toISOString(),
                            basecamp_sync_error: null,
                        })
                        .eq('id', saved.logId)
                        .eq('organization_id', saved.organizationId);
                    query = saved.previousEntryId
                        ? query.eq('basecamp_entry_id', Number(saved.previousEntryId))
                        : query.is('basecamp_entry_id', null);
                    const { data, error } = await query.select('id');
                    return !error && (data?.length ?? 0) > 0;
                },
            });
        },
        provider: {
            isConfigured: isBasecampConfigured,
            getTodo: async (projectId, todoId) => {
                const todo = await getBasecampTodo(projectId, todoId);
                if (!todo) return null;
                return { id: todo.id, supportsSubtasks: basecampSubtaskSupport(todo) };
            },
            listTodolists: projectId => listBasecampTodolists(projectId),
            createTodo: (projectId, todolistId, params) => (
                createBasecampTodo(projectId, todolistId, params)
            ),
            createStep: (projectId, parentTodoId, title) => (
                createBasecampTodoStep(projectId, parentTodoId, title)
            ),
            async recordingKind(projectId, recordingId) {
                const body = await getBasecampRecording(projectId, recordingId);
                if (body == null) return null;
                return completableRecordingKind(classifyBasecampRecording(body));
            },
            completeTodo: (projectId, todoId) => completeBasecampTodo(projectId, todoId),
            reopenTodo: (projectId, todoId) => reopenBasecampTodo(projectId, todoId),
            completeStep: (_projectId, stepId) => completeBasecampStep(stepId),
            reopenStep: (_projectId, stepId) => reopenBasecampStep(stepId),
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
}
