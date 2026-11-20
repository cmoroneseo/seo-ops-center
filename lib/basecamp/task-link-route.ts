import { numericId } from './import-tasks-route.ts';
import { parseBasecampTodoInput } from './todo-input.ts';
import {
    importBasecampTodoSteps,
    readBasecampTodo,
    readBasecampTodoSteps,
    type BasecampLinkedTask,
    type BasecampLinkStore,
    type BasecampTodoReader,
} from './task-todo-link.ts';

type AuthorizedTask = {
    ok: true;
    userId: string;
    taskId: string;
    organizationId: string;
    clientId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
};

interface TaskLinkStore extends BasecampLinkStore<BasecampLinkedTask> {
    getTask(authorization: AuthorizedTask): Promise<(BasecampLinkedTask & { configuredProjectId: unknown }) | null>;
}

export interface BasecampTaskLinkDependencies {
    authorizeTask(taskId: string): Promise<AuthorizedTask | { ok: false; error: string; status: number }>;
    createStore(): TaskLinkStore;
    provider: BasecampTodoReader & { isConfigured(): boolean };
    resolveAssignees?(organizationId: string, personIds: number[]): Promise<Map<number, string>>;
    now(): string;
}

const WRITABLE_ROLES = new Set(['owner', 'admin', 'member']);
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function error(message: string, status: number) {
    return Response.json({ error: message }, { status });
}

function wrongProject() {
    return error('The to-do was not found in this client’s Basecamp project.', 404);
}

function conflict() {
    return error('The Basecamp to-do or this task already has a conflicting link.', 409);
}

export function createBasecampTaskLinkHandler(
    action: 'link' | 'refresh' | 'check',
    deps: BasecampTaskLinkDependencies,
) {
    return async (req: Request): Promise<Response> => {
        const body = action === 'check'
            ? { taskId: new URL(req.url).searchParams.get('taskId') }
            : await req.json().catch(() => null) as { taskId?: unknown; basecampTodoId?: unknown } | null;
        const taskId = typeof body?.taskId === 'string' ? body.taskId.trim().toLowerCase() : '';
        if (!TASK_ID.test(taskId)) return error('A valid taskId is required.', 400);

        try {
            const auth = await deps.authorizeTask(taskId);
            if (!auth.ok) return error(auth.error, auth.status);
            if (!WRITABLE_ROLES.has(auth.role)) return error('Forbidden', 403);

            const store = deps.createStore();
            const task = await store.getTask(auth);
            if (!task || task.id !== taskId || task.organizationId !== auth.organizationId || task.clientId !== auth.clientId) {
                return error('Task not found.', 404);
            }
            if (task.parentTaskId) return error('Basecamp to-do actions are only available for top-level tasks.', 400);

            const input = action === 'link' ? parseBasecampTodoInput(body?.basecampTodoId) : null;
            if (action === 'link' && !input) return error('Enter a Basecamp to-do URL or a positive to-do ID.', 400);
            const todoId = input?.todoId ?? numericId(task.basecampTodoId);
            if (!todoId) return error('This task has no Basecamp to-do link.', 409);
            const configuredProjectId = numericId(task.configuredProjectId);
            if (!configuredProjectId) return error('This client has no configured Basecamp project.', 409);
            const projectId = String(Number(configuredProjectId));
            if (input?.projectId && input.projectId !== projectId) return wrongProject();
            if (action !== 'link' && task.basecampProjectId && task.basecampProjectId !== projectId) return wrongProject();

            const { provider } = deps;
            if (!provider.isConfigured()) return error('Basecamp is not configured.', 503);
            if (action === 'check') {
                const kind = await provider.recordingKind(projectId, todoId);
                if (!kind) return wrongProject();
                return Response.json({ canRefresh: kind === 'todo' });
            }

            const recording = await readBasecampTodo(provider, projectId, todoId);
            if (recording.kind === 'step') return error('Use a Basecamp to-do. This recording is a step.', 400);
            if (recording.kind === 'missing') return wrongProject();

            if (action === 'link') {
                if (task.basecampTodoId && (task.basecampTodoId !== todoId
                    || (task.basecampProjectId && task.basecampProjectId !== projectId))) return conflict();
                const claims = await store.findRecordings([todoId]);
                if (claims.length > 1 || claims.some(claim => claim.id !== task.id)) return conflict();
            }

            const steps = await readBasecampTodoSteps(provider, projectId, todoId, recording.todo).catch(() => null);
            if (!steps) return error('Basecamp steps could not be read. Try again.', 502);
            const now = deps.now();
            const root = action === 'link' && !task.basecampTodoId
                ? await store.updateTaskLink(task, projectId, todoId, now)
                : task;
            if (!root) return conflict();

            const { resolveAssignees } = deps;
            const { imported, linked } = await importBasecampTodoSteps({
                store, root, projectId, todoId, steps, now, userId: auth.userId,
                matchExistingTitles: action === 'link',
                resolveAssignees: resolveAssignees
                    ? personIds => resolveAssignees(auth.organizationId, personIds)
                    : undefined,
            });
            return Response.json({ todoId, projectId, imported: imported.length, linked });
        } catch (cause) {
            console.error('[Basecamp] Task link or refresh failed', cause);
            return error('Unable to save the Basecamp link or steps. Try again.', 500);
        }
    };
}
