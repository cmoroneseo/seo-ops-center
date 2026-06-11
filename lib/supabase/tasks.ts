import { createClient } from './client';
import { createNotification } from './notifications';
import {
    Task,
    TaskStatus,
    TaskPriority,
    TaskCategory,
    TaskStatusHistoryEntry,
    TaskComment,
    TaskTemplate,
} from '../types';
import { getNextDueDate } from '../utils/recurrence';

// ---------------------------------------------------------------------------
// Basecamp integration helpers (fire-and-forget, server-side only)
// ---------------------------------------------------------------------------

/** Checks if a client has Basecamp sync enabled and returns its config. */
async function getClientBasecampConfig(clientId: string | undefined): Promise<{
    projectId: string;
    todolistId: string;
} | null> {
    if (!clientId) return null;
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data } = await supabase
            .from('clients')
            .select('custom_fields')
            .eq('id', clientId)
            .single();
        const cf = data?.custom_fields as Record<string, unknown> ?? {};
        if (!cf.basecamp_sync_enabled) return null;
        const projectId = cf.basecamp_project_id as string;
        if (!projectId) return null;
        const todolistId = (cf.basecamp_todolist_id as string) ?? '';
        return { projectId, todolistId };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToTask(row: any): Task {
    return {
        id: row.id,
        organizationId: row.organization_id,
        projectId: row.project_id ?? undefined,
        clientId: row.client_id ?? undefined,
        clientName: row.clients?.name ?? row.client_name ?? undefined,
        title: row.title,
        description: row.description ?? undefined,
        assigneeIds: row.assignee_ids ?? [],
        assignees: row.assignee_ids ?? [], // backward compat
        dueDate: row.due_date ?? undefined,
        startDate: row.start_date ?? undefined,
        completedAt: row.completed_at ?? undefined,
        priority: (row.priority as TaskPriority) ?? 'medium',
        status: (row.status as TaskStatus) ?? 'todo',
        category: (row.category as TaskCategory) ?? undefined,
        tags: row.tags ?? [],
        subtasks: [], // loaded separately if needed
        estimatedHours: row.estimated_hours ?? undefined,
        deliverableId: row.deliverable_id ?? undefined,
        parentTaskId: row.parent_task_id ?? undefined,
        sortOrder: row.sort_order ?? 0,
        statusHistory: row.status_history ?? [],
        customFields: row.custom_fields ?? {},
        watcherIds: row.watcher_ids ?? [],
        createdBy: row.created_by ?? undefined,
        templateId: row.template_id ?? undefined,
        recurrence: row.recurrence ?? undefined,
        basecampTodoId: row.basecamp_todo_id ?? undefined,
        basecampProjectId: row.basecamp_project_id ?? undefined,
        lastSyncedAt: row.last_synced_at ?? undefined,
    };
}

function rowToComment(row: any): TaskComment {
    return {
        id: row.id,
        organizationId: row.organization_id,
        taskId: row.task_id,
        authorId: row.author_id ?? undefined,
        authorName: row.author_name ?? undefined,
        body: row.body,
        mentions: row.mentions ?? [],
        basecampCommentId: row.basecamp_comment_id ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

type TaskInsert = {
    organizationId: string;
    projectId?: string;
    clientId?: string;
    title: string;
    description?: string;
    assigneeIds?: string[];
    dueDate?: string;
    startDate?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    category?: TaskCategory;
    tags?: string[];
    estimatedHours?: number;
    deliverableId?: string;
    parentTaskId?: string;
    sortOrder?: number;
    createdBy?: string;
    templateId?: string;
    recurrence?: Task['recurrence'];
    /** If true, pushes this task to Basecamp on create (requires client Basecamp config). */
    syncToBasecamp?: boolean;
    /** Override the client's default todolist for this specific task. */
    basecampTodolistId?: string;
};

function taskToRow(t: Partial<TaskInsert>) {
    return {
        organization_id: t.organizationId,
        project_id: t.projectId,
        client_id: t.clientId,
        title: t.title,
        description: t.description,
        assignee_ids: t.assigneeIds ?? [],
        due_date: t.dueDate,
        start_date: t.startDate,
        priority: t.priority ?? 'medium',
        status: t.status ?? 'todo',
        category: t.category,
        tags: t.tags ?? [],
        estimated_hours: t.estimatedHours,
        deliverable_id: t.deliverableId,
        parent_task_id: t.parentTaskId,
        sort_order: t.sortOrder ?? 0,
        created_by: t.createdBy,
        template_id: t.templateId,
        recurrence: t.recurrence,
    };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface TaskFilters {
    clientId?: string;
    status?: TaskStatus | TaskStatus[];
    assigneeId?: string;
    category?: TaskCategory;
    parentTaskId?: string | null;
}

/** All tasks for an org, optionally filtered. Joins client name. */
export async function getTasks(
    organizationId: string,
    filters: TaskFilters = {},
): Promise<Task[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase
            .from('tasks')
            .select('*, clients(name)')
            .eq('organization_id', organizationId)
            .is('parent_task_id', null); // top-level only; subtasks fetched separately

        if (filters.clientId) q = q.eq('client_id', filters.clientId);
        if (filters.assigneeId) q = q.contains('assignee_ids', [filters.assigneeId]);
        if (filters.category) q = q.eq('category', filters.category);
        if (filters.parentTaskId !== undefined) {
            filters.parentTaskId === null
                ? (q = q.is('parent_task_id', null))
                : (q = q.eq('parent_task_id', filters.parentTaskId));
        }
        if (filters.status) {
            if (Array.isArray(filters.status)) {
                q = q.in('status', filters.status);
            } else {
                q = q.eq('status', filters.status);
            }
        }

        const { data, error } = await q.order('sort_order', { ascending: true }).order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToTask);
    } catch (err) {
        console.error('Error fetching tasks:', err);
        return [];
    }
}

/** Tasks scoped to one client — used on the client detail Tasks tab. */
export async function getTasksByClient(clientId: string): Promise<Task[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('tasks')
            .select('*, clients(name)')
            .eq('client_id', clientId)
            .is('parent_task_id', null)
            .order('sort_order', { ascending: true })
            .order('due_date', { ascending: true });
        if (error) throw error;
        return (data || []).map(rowToTask);
    } catch (err) {
        console.error('Error fetching tasks by client:', err);
        return [];
    }
}

/** Single task with its subtasks and total logged hours. */
export async function getTask(taskId: string): Promise<{
    task: Task | null;
    subtasks: Task[];
    loggedHours: number;
}> {
    const supabase = createClient();
    if (!supabase) return { task: null, subtasks: [], loggedHours: 0 };
    try {
        const [taskRes, subtasksRes, hoursRes] = await Promise.all([
            supabase.from('tasks').select('*, clients(name)').eq('id', taskId).single(),
            supabase.from('tasks').select('*, clients(name)').eq('parent_task_id', taskId).order('sort_order'),
            supabase.from('time_logs').select('hours').eq('task_id', taskId).eq('status', 'logged'),
        ]);

        if (taskRes.error) throw taskRes.error;

        const loggedHours = (hoursRes.data || []).reduce((sum: number, row: any) => sum + (row.hours || 0), 0);

        return {
            task: taskRes.data ? rowToTask(taskRes.data) : null,
            subtasks: (subtasksRes.data || []).map(rowToTask),
            loggedHours,
        };
    } catch (err) {
        console.error('Error fetching task:', err);
        return { task: null, subtasks: [], loggedHours: 0 };
    }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createTask(
    t: TaskInsert,
): Promise<{ success: boolean; data?: Task; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const row = {
            ...taskToRow(t),
            status_history: [{ status: t.status ?? 'todo', at: new Date().toISOString(), by: t.createdBy }],
        };
        const { data, error } = await supabase.from('tasks').insert([row]).select('*, clients(name)').single();
        if (error) throw error;
        const task = rowToTask(data);

        // Notify each assignee that they've been assigned this task
        if (t.assigneeIds && t.assigneeIds.length > 0) {
            t.assigneeIds.forEach((recipientId) => {
                createNotification({
                    organizationId: t.organizationId,
                    userId: recipientId,
                    type: 'task_assigned',
                    title: 'You were assigned a task',
                    body: task.title,
                    entityType: 'task',
                    entityId: task.id,
                    clientId: task.clientId,
                });
            });
        }

        // Basecamp push — fire-and-forget via API route (works from browser)
        // Only fires when the user explicitly opted in via the "Sync to Basecamp" toggle.
        if (t.syncToBasecamp && t.clientId) {
            getClientBasecampConfig(t.clientId).then((bc) => {
                if (!bc) return;
                // Per-task override takes priority over the client's default todolist
                const todolistId = t.basecampTodolistId || bc.todolistId;
                if (!todolistId) return;
                fetch('/api/integrations/basecamp/push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'create_todo',
                        taskId: task.id,
                        projectId: bc.projectId,
                        todolistId,
                        content: task.title,
                        dueOn: task.dueDate,
                        description: task.description,
                    }),
                }).catch(err => console.error('[Basecamp] createTask push error:', err));
            });
        }

        return { success: true, data: task };
    } catch (err: any) {
        console.error('Error creating task:', err);
        return { success: false, error: err.message };
    }
}

export async function updateTask(
    taskId: string,
    patch: Partial<TaskInsert> & {
        status?: TaskStatus;
        completedAt?: string | null;
        assigneeIds?: string[];
        tags?: string[];
        estimatedHours?: number | null;
        sortOrder?: number;
        updatedBy?: string;
    },
): Promise<{ success: boolean; data?: Task; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        // Build row, stripping undefined values
        const candidate: Record<string, unknown> = {
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.description !== undefined && { description: patch.description }),
            ...(patch.assigneeIds !== undefined && { assignee_ids: patch.assigneeIds }),
            ...(patch.dueDate !== undefined && { due_date: patch.dueDate }),
            ...(patch.startDate !== undefined && { start_date: patch.startDate }),
            ...(patch.priority !== undefined && { priority: patch.priority }),
            ...(patch.status !== undefined && { status: patch.status }),
            ...(patch.category !== undefined && { category: patch.category }),
            ...(patch.tags !== undefined && { tags: patch.tags }),
            ...(patch.estimatedHours !== undefined && { estimated_hours: patch.estimatedHours }),
            ...(patch.deliverableId !== undefined && { deliverable_id: patch.deliverableId }),
            ...(patch.parentTaskId !== undefined && { parent_task_id: patch.parentTaskId }),
            ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
            ...(patch.recurrence !== undefined && { recurrence: patch.recurrence }),
            ...(patch.completedAt !== undefined && { completed_at: patch.completedAt }),
        };

        // Fetch current task row when status or assignees are changing
        // (needed for status_history append, recurring spawn, and assignee diff)
        let current: Record<string, any> | null = null;
        if (patch.status || patch.assigneeIds !== undefined) {
            const { data: cur } = await supabase
                .from('tasks')
                .select('status_history, recurrence, due_date, title, description, priority, category, tags, estimated_hours, assignee_ids, client_id, project_id, organization_id, template_id')
                .eq('id', taskId)
                .single();
            current = cur;
        }

        // Append to status_history when status changes
        if (patch.status && current) {
            const history: TaskStatusHistoryEntry[] = current.status_history ?? [];
            history.push({ status: patch.status, at: new Date().toISOString(), by: patch.updatedBy });
            candidate.status_history = history;

            // Auto-set completed_at when moving to done
            if (patch.status === 'done' && patch.completedAt === undefined) {
                candidate.completed_at = new Date().toISOString();
            }
            // Clear completed_at when un-done
            if (patch.status !== 'done' && patch.completedAt === undefined) {
                candidate.completed_at = null;
            }

            // Auto-spawn next recurring instance when marking done
            if (patch.status === 'done' && current.recurrence) {
                const nextDue = getNextDueDate(current.recurrence, current.due_date ?? new Date().toISOString().slice(0, 10));
                if (nextDue) {
                    // Fire-and-forget — don't block the main update
                    createTask({
                        organizationId: current.organization_id,
                        projectId: current.project_id ?? undefined,
                        clientId: current.client_id ?? undefined,
                        title: current.title,
                        description: current.description ?? undefined,
                        priority: current.priority ?? 'medium',
                        category: current.category ?? undefined,
                        tags: current.tags ?? [],
                        estimatedHours: current.estimated_hours ?? undefined,
                        assigneeIds: current.assignee_ids ?? [],
                        dueDate: nextDue,
                        templateId: current.template_id ?? undefined,
                        recurrence: current.recurrence,
                        parentTaskId: taskId, // link back to this completed task
                    }).catch(err => console.error('Recurring task spawn error:', err));
                }
            }
        }

        // Notify newly added assignees
        if (patch.assigneeIds !== undefined && current) {
            const prevIds: string[] = current.assignee_ids ?? [];
            const addedIds = patch.assigneeIds.filter((id) => !prevIds.includes(id));
            addedIds.forEach((recipientId) => {
                createNotification({
                    organizationId: current!.organization_id,
                    userId: recipientId,
                    type: 'task_assigned',
                    title: 'You were assigned a task',
                    body: current!.title,
                    entityType: 'task',
                    entityId: taskId,
                    clientId: current!.client_id ?? undefined,
                });
            });
        }

        const { data, error } = await supabase
            .from('tasks')
            .update(candidate)
            .eq('id', taskId)
            .select('*, clients(name), basecamp_todo_id, basecamp_project_id, client_id')
            .single();
        if (error) throw error;
        const updatedTask = rowToTask(data);

        // Basecamp complete/reopen — fire-and-forget via API route
        if (patch.status && data.basecamp_todo_id && data.basecamp_project_id) {
            const bcAction = patch.status === 'done' ? 'complete_todo'
                : (patch.status === 'todo' || patch.status === 'in_progress') ? 'reopen_todo'
                : null;
            if (bcAction) {
                fetch('/api/integrations/basecamp/push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: bcAction,
                        taskId,
                        projectId: data.basecamp_project_id,
                        todoId: data.basecamp_todo_id,
                    }),
                }).catch(err => console.error('[Basecamp] updateTask sync error:', err));
            }
        }

        return { success: true, data: updatedTask };
    } catch (err: any) {
        console.error('Error updating task:', err);
        return { success: false, error: err.message };
    }
}

export async function deleteTask(taskId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        // Subtasks cascade via FK; comments cascade via FK
        const { error } = await supabase.from('tasks').delete().eq('id', taskId);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error deleting task:', err);
        return { success: false, error: err.message };
    }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function getTaskComments(taskId: string): Promise<TaskComment[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('task_comments')
            .select('*')
            .eq('task_id', taskId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return (data || []).map(rowToComment);
    } catch (err) {
        console.error('Error fetching task comments:', err);
        return [];
    }
}

export async function createTaskComment(params: {
    organizationId: string;
    taskId: string;
    authorId?: string;
    authorName?: string;
    body: string;
    mentions?: string[];
}): Promise<{ success: boolean; data?: TaskComment; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data, error } = await supabase
            .from('task_comments')
            .insert([{
                organization_id: params.organizationId,
                task_id: params.taskId,
                author_id: params.authorId,
                author_name: params.authorName,
                body: params.body,
                mentions: params.mentions ?? [],
            }])
            .select()
            .single();
        if (error) throw error;
        const comment = rowToComment(data);

        // Notify @mentioned users in the comment
        if (params.mentions && params.mentions.length > 0) {
            // Fetch the task to get clientId for navigation
            supabase
                .from('tasks')
                .select('client_id, organization_id, title')
                .eq('id', params.taskId)
                .single()
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then(({ data: taskRow }: { data: any }) => {
                    (params.mentions ?? []).forEach((mentionedUserId) => {
                        createNotification({
                            organizationId: taskRow?.organization_id ?? params.organizationId,
                            userId: mentionedUserId,
                            type: 'task_mentioned',
                            title: 'You were mentioned in a task comment',
                            body: params.body.slice(0, 120),
                            entityType: 'task_comment',
                            entityId: comment.id,
                            clientId: taskRow?.client_id ?? undefined,
                        });
                    });
                });
        }

        // Basecamp comment push — fire-and-forget via API route
        supabase
            .from('tasks')
            .select('basecamp_todo_id, basecamp_project_id')
            .eq('id', params.taskId)
            .single()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .then(({ data: taskRow }: { data: any }) => {
                if (!taskRow?.basecamp_todo_id || !taskRow?.basecamp_project_id) return;
                const authorLabel = params.authorName ? `**${params.authorName}:** ` : '';
                fetch('/api/integrations/basecamp/push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'create_comment',
                        taskId: params.taskId,
                        projectId: taskRow.basecamp_project_id,
                        todoId: taskRow.basecamp_todo_id,
                        content: `${authorLabel}${params.body}`,
                    }),
                }).catch(err => console.error('[Basecamp] comment push error:', err));
            });

        return { success: true, data: comment };
    } catch (err: any) {
        console.error('Error creating task comment:', err);
        return { success: false, error: err.message };
    }
}

export async function deleteTaskComment(commentId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('task_comments').delete().eq('id', commentId);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error deleting task comment:', err);
        return { success: false, error: err.message };
    }
}

// ---------------------------------------------------------------------------
// Task Templates
// ---------------------------------------------------------------------------

function rowToTemplate(row: any): TaskTemplate {
    return {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description ?? undefined,
        category: row.category ?? undefined,
        estimatedHours: row.estimated_hours ?? undefined,
        priority: row.priority ?? 'medium',
        tags: row.tags ?? [],
        checklist: row.checklist ?? [],
        recurrence: row.recurrence ?? undefined,
        createdBy: row.created_by ?? undefined,
        createdAt: row.created_at,
    };
}

export async function getTaskTemplates(organizationId: string): Promise<TaskTemplate[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('task_templates')
            .select('*')
            .eq('organization_id', organizationId)
            .order('category', { ascending: true })
            .order('name', { ascending: true });
        if (error) throw error;
        return (data || []).map(rowToTemplate);
    } catch (err) {
        console.error('Error fetching task templates:', err);
        return [];
    }
}

type TaskTemplateInsert = {
    organizationId: string;
    name: string;
    description?: string;
    category?: TaskCategory;
    estimatedHours?: number;
    priority?: TaskPriority;
    tags?: string[];
    checklist?: { title: string; required: boolean }[];
    recurrence?: TaskTemplate['recurrence'];
    createdBy?: string;
};

export async function createTaskTemplate(t: TaskTemplateInsert): Promise<{ success: boolean; data?: TaskTemplate; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data, error } = await supabase
            .from('task_templates')
            .insert([{
                organization_id: t.organizationId,
                name: t.name,
                description: t.description,
                category: t.category,
                estimated_hours: t.estimatedHours,
                priority: t.priority ?? 'medium',
                tags: t.tags ?? [],
                checklist: t.checklist ?? [],
                recurrence: t.recurrence,
                created_by: t.createdBy,
            }])
            .select()
            .single();
        if (error) throw error;
        return { success: true, data: rowToTemplate(data) };
    } catch (err: any) {
        console.error('Error creating task template:', err);
        return { success: false, error: err.message };
    }
}

export async function updateTaskTemplate(
    templateId: string,
    patch: Partial<Omit<TaskTemplateInsert, 'organizationId'>>,
): Promise<{ success: boolean; data?: TaskTemplate; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const candidate: Record<string, unknown> = {
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.description !== undefined && { description: patch.description }),
            ...(patch.category !== undefined && { category: patch.category }),
            ...(patch.estimatedHours !== undefined && { estimated_hours: patch.estimatedHours }),
            ...(patch.priority !== undefined && { priority: patch.priority }),
            ...(patch.tags !== undefined && { tags: patch.tags }),
            ...(patch.checklist !== undefined && { checklist: patch.checklist }),
            ...(patch.recurrence !== undefined && { recurrence: patch.recurrence }),
        };
        const { data, error } = await supabase
            .from('task_templates')
            .update(candidate)
            .eq('id', templateId)
            .select()
            .single();
        if (error) throw error;
        return { success: true, data: rowToTemplate(data) };
    } catch (err: any) {
        console.error('Error updating task template:', err);
        return { success: false, error: err.message };
    }
}

export async function deleteTaskTemplate(templateId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('task_templates').delete().eq('id', templateId);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error deleting task template:', err);
        return { success: false, error: err.message };
    }
}

/** Create a task pre-filled from a template. Caller can override any field. */
export async function createTaskFromTemplate(
    templateId: string,
    overrides: Partial<TaskInsert> & { organizationId: string },
): Promise<{ success: boolean; data?: Task; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data: tpl, error: tplErr } = await supabase
            .from('task_templates')
            .select('*')
            .eq('id', templateId)
            .single();
        if (tplErr || !tpl) throw tplErr ?? new Error('Template not found');

        return createTask({
            organizationId: overrides.organizationId,
            title: overrides.title ?? tpl.name,
            description: overrides.description ?? tpl.description,
            priority: overrides.priority ?? tpl.priority ?? 'medium',
            category: overrides.category ?? tpl.category,
            estimatedHours: overrides.estimatedHours ?? tpl.estimated_hours,
            tags: overrides.tags ?? tpl.tags ?? [],
            recurrence: overrides.recurrence ?? tpl.recurrence,
            templateId,
            dueDate: overrides.dueDate,
            clientId: overrides.clientId,
            projectId: overrides.projectId,
            createdBy: overrides.createdBy,
            assigneeIds: overrides.assigneeIds,
            syncToBasecamp: overrides.syncToBasecamp,
            basecampTodolistId: overrides.basecampTodolistId,
        });
    } catch (err: any) {
        console.error('Error creating task from template:', err);
        return { success: false, error: err.message };
    }
}
