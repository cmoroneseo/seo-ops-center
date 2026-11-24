import { requireTaskOrgMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { membersByBasecampPersonId } from '@/lib/supabase/timesheet-imports';
import { basecampSubtaskSupport, getBasecampTodo, isBasecampConfigured, listBasecampTodoSteps } from './api.ts';
import { normalizeJsonObject } from './project-access.ts';
import { basecampRecordingKind } from './push-live.ts';
import { createBasecampTaskLinkHandler } from './task-link-route.ts';
import type { BasecampLinkedTask } from './task-todo-link.ts';

const TASK_COLUMNS = 'id, organization_id, client_id, title, priority, category, parent_task_id, basecamp_todo_id, basecamp_project_id';

function taskRecord(row: {
    id: string;
    organization_id: string;
    client_id: string;
    title: string;
    category: string | null;
    priority: string | null;
    parent_task_id: string | null;
    basecamp_todo_id: number | null;
    basecamp_project_id: number | null;
}): BasecampLinkedTask {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        title: row.title,
        category: row.category,
        priority: row.priority,
        parentTaskId: row.parent_task_id,
        basecampTodoId: row.basecamp_todo_id == null ? null : String(row.basecamp_todo_id),
        basecampProjectId: row.basecamp_project_id == null ? null : String(row.basecamp_project_id),
    };
}

export function createLiveBasecampTaskLinkHandler(action: 'link' | 'refresh' | 'check') {
    return createBasecampTaskLinkHandler(action, {
        authorizeTask: requireTaskOrgMember,
        createStore() {
            const admin = createAdminClient();
            return {
                async getTask({ taskId, organizationId, clientId }) {
                    const { data, error } = await admin.from('tasks')
                        .select(`${TASK_COLUMNS}, clients!inner(custom_fields)`)
                        .eq('id', taskId)
                        .eq('organization_id', organizationId)
                        .eq('client_id', clientId)
                        .eq('clients.organization_id', organizationId)
                        .maybeSingle();
                    if (error) throw error;
                    if (!data) return null;
                    const client = Array.isArray(data.clients) ? data.clients[0] : data.clients;
                    return {
                        ...taskRecord(data),
                        configuredProjectId: normalizeJsonObject(client?.custom_fields).basecamp_project_id,
                    };
                },
                async findRecordings(ids) {
                    // A recording can already be claimed outside this client's organization.
                    const matches: BasecampLinkedTask[] = [];
                    for (let i = 0; i < ids.length; i += 100) {
                        const { data, error } = await admin.from('tasks').select(TASK_COLUMNS)
                            .in('basecamp_todo_id', ids.slice(i, i + 100));
                        if (error) throw error;
                        matches.push(...(data ?? []).map(taskRecord));
                    }
                    return matches;
                },
                async listChildren(parent) {
                    const { data, error } = await admin.from('tasks').select(TASK_COLUMNS)
                        .eq('organization_id', parent.organizationId)
                        .eq('client_id', parent.clientId)
                        .eq('parent_task_id', parent.id);
                    if (error) throw error;
                    return (data ?? []).map(taskRecord);
                },
                async updateTaskLink(task, projectId, todoId, now) {
                    const scoped = admin.from('tasks').update({
                        basecamp_project_id: Number(projectId),
                        basecamp_todo_id: Number(todoId),
                        last_synced_at: now,
                    }).eq('id', task.id).eq('organization_id', task.organizationId).eq('client_id', task.clientId)
                        .is('basecamp_todo_id', null);
                    const update = task.parentTaskId === null
                        ? scoped.is('parent_task_id', null)
                        : scoped.eq('parent_task_id', task.parentTaskId);
                    const { data, error } = await update.select(TASK_COLUMNS).maybeSingle();
                    if (error) throw error;
                    if (data) return taskRecord(data);

                    // The same link may have landed after this request read the task.
                    const { data: current, error: readError } = await admin.from('tasks').select(TASK_COLUMNS)
                        .eq('id', task.id).eq('organization_id', task.organizationId).eq('client_id', task.clientId)
                        .maybeSingle();
                    if (readError) throw readError;
                    const saved = current && taskRecord(current);
                    return saved?.basecampTodoId === todoId && saved.basecampProjectId === projectId
                        && saved.parentTaskId === task.parentTaskId ? saved : null;
                },
                async insertImportedTasks(rows) {
                    const { data, error } = await admin.from('tasks').insert(rows).select(TASK_COLUMNS);
                    if (error) throw error;
                    return (data ?? []).map(taskRecord);
                },
            };
        },
        provider: {
            isConfigured: isBasecampConfigured,
            recordingKind: basecampRecordingKind,
            async getTodo(projectId, todoId) {
                const todo = await getBasecampTodo(projectId, todoId);
                return todo ? { ...todo, supportsSubtasks: basecampSubtaskSupport(todo) } : null;
            },
            listSteps: (projectId, todoId) => listBasecampTodoSteps(projectId, todoId, { strict: true }),
        },
        resolveAssignees: membersByBasecampPersonId,
        now: () => new Date().toISOString(),
    });
}
