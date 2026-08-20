import {
    authorizeBasecampProject,
    type BasecampProjectAccessSource,
} from './project-access.ts';

type TaskAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string;
        taskId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
        canManageIntegrations: boolean;
    }
    | { ok: false; status: number; error: string };

interface CanonicalTask {
    id: string;
    organizationId: string;
    clientId: string;
    title: string;
    description?: string | null;
    dueDate?: string | null;
    status: string;
    basecampTodoId?: string | number | null;
    basecampProjectId?: string | number | null;
    configuredProjectId?: string | number | null;
    configuredTodolistId?: string | number | null;
    syncEnabled: boolean;
    assigneePersonIds: number[];
}

interface PushStore {
    getTask(taskId: string, organizationId: string, clientId: string): Promise<CanonicalTask | null>;
    updateTaskLink(
        taskId: string,
        organizationId: string,
        clientId: string,
        projectId: string,
        todoId: string,
        syncedAt: string,
    ): Promise<string | null>;
    markTaskSynced(
        taskId: string,
        organizationId: string,
        clientId: string,
        syncedAt: string,
    ): Promise<string | null>;
}

interface Provider {
    isConfigured(): boolean;
    getTodo(projectId: string, todoId: string): Promise<{ id: string | number } | null>;
    listTodolists(projectId: string): Promise<Array<{ id: string | number }>>;
    createTodo(
        projectId: string,
        todolistId: string,
        params: {
            content: string;
            dueOn?: string;
            description?: string;
            assigneePersonIds?: number[];
        },
    ): Promise<{ id: string | number; appUrl: string } | null>;
    completeTodo(projectId: string, todoId: string): Promise<boolean>;
    reopenTodo(projectId: string, todoId: string): Promise<boolean>;
    createComment(projectId: string, todoId: string, content: string): Promise<number | null>;
    updateTodoDueDate(projectId: string, todoId: string, dueOn: string | null): Promise<boolean>;
    updateTodoAssignees(projectId: string, todoId: string, personIds: number[]): Promise<boolean>;
}

interface Dependencies {
    authorizeTask(taskId: unknown): Promise<TaskAuthorization>;
    createStore(): PushStore;
    createAccessSource(): BasecampProjectAccessSource;
    provider: Provider;
    now(): string;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function numericId(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

export function createBasecampPushPost(dependencies: Dependencies) {
    return async function postBasecampPush(req: Request): Promise<Response> {
        try {
            const body = await req.json() as Record<string, unknown>;
            const action = typeof body.action === 'string' ? body.action : '';
            if (!action || !body.taskId) return json({ error: 'action and taskId are required' }, 400);

            const authorization = await dependencies.authorizeTask(body.taskId);
            if (!authorization.ok) {
                return json({ error: authorization.error }, authorization.status);
            }

            const store = dependencies.createStore();
            const task = await store.getTask(
                authorization.taskId,
                authorization.organizationId,
                authorization.clientId,
            );
            if (!task) return json({ error: 'Task not found' }, 404);

            const isCreate = action === 'create_todo';
            const configuredProjectId = numericId(task.configuredProjectId);
            const linkedProjectId = numericId(task.basecampProjectId);
            if (!isCreate && linkedProjectId !== configuredProjectId) {
                return json({ error: 'Task Basecamp link does not match its client configuration' }, 409);
            }
            const projectId = configuredProjectId;
            if (!projectId || (isCreate && !task.syncEnabled)) {
                return json({ error: 'Task has no authorized Basecamp project' }, 409);
            }

            const projectAccess = await authorizeBasecampProject(
                {
                    userId: authorization.userId,
                    organizationId: authorization.organizationId,
                    projectId,
                },
                dependencies.createAccessSource(),
            );
            if (!projectAccess.ok) {
                return json({ error: projectAccess.error }, projectAccess.status);
            }

            if (!dependencies.provider.isConfigured()) {
                return json({ error: 'Basecamp not configured', configured: false }, 503);
            }

            if (isCreate) {
                const todolistId = numericId(task.configuredTodolistId);
                if (!todolistId) return json({ error: 'Task has no authorized Basecamp todolist' }, 409);
                const todolists = await dependencies.provider.listTodolists(projectId);
                if (!todolists.some(list => String(list.id) === todolistId)) {
                    return json({ error: 'Todolist is not authorized' }, 403);
                }

                const created = await dependencies.provider.createTodo(projectId, todolistId, {
                    content: task.title,
                    dueOn: task.dueDate || undefined,
                    description: task.description || undefined,
                    assigneePersonIds: task.assigneePersonIds.length > 0
                        ? task.assigneePersonIds
                        : undefined,
                });
                if (created) {
                    const updateError = await store.updateTaskLink(
                        task.id,
                        task.organizationId,
                        task.clientId,
                        projectId,
                        String(created.id),
                        dependencies.now(),
                    );
                    if (updateError) return json({ error: updateError }, 500);
                }
                return json({ success: Boolean(created), todoId: created?.id });
            }

            const todoId = numericId(task.basecampTodoId);
            if (!todoId) return json({ error: 'Task has no authorized Basecamp todo' }, 409);
            const providerTodo = await dependencies.provider.getTodo(projectId, todoId);
            if (!providerTodo || String(providerTodo.id) !== todoId) {
                return json({ error: 'Basecamp todo is not authorized' }, 403);
            }

            let success = false;
            let commentId: number | null = null;
            switch (action) {
                case 'complete_todo':
                    success = await dependencies.provider.completeTodo(projectId, todoId);
                    break;
                case 'reopen_todo':
                    success = await dependencies.provider.reopenTodo(projectId, todoId);
                    break;
                case 'create_comment': {
                    const content = typeof body.content === 'string' ? body.content.trim() : '';
                    if (!content) return json({ error: 'Comment content required' }, 400);
                    commentId = await dependencies.provider.createComment(projectId, todoId, content);
                    return json({ success: Boolean(commentId), commentId });
                }
                case 'update_todo_due_date':
                    success = await dependencies.provider.updateTodoDueDate(
                        projectId,
                        todoId,
                        task.dueDate || null,
                    );
                    break;
                case 'update_todo_assignees':
                    success = await dependencies.provider.updateTodoAssignees(
                        projectId,
                        todoId,
                        task.assigneePersonIds,
                    );
                    break;
                default:
                    return json({ error: `Unknown action: ${action}` }, 400);
            }

            if (success) {
                const updateError = await store.markTaskSynced(
                    task.id,
                    task.organizationId,
                    task.clientId,
                    dependencies.now(),
                );
                if (updateError) return json({ error: updateError }, 500);
            }
            return json({ success });
        } catch {
            return json({ error: 'Unable to update Basecamp task' }, 500);
        }
    };
}
