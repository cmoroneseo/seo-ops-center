import {
    authorizeBasecampProject,
    type BasecampProjectAccessSource,
} from './project-access.ts';

interface ImportTaskPayload {
    basecampTodoId: number;
    basecampProjectId: number;
    category?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
}

type ClientAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
    }
    | { ok: false; status: number; error: string };

interface ImportWriter {
    insertTasks(rows: Array<Record<string, unknown>>): Promise<string | null>;
    logActivity(payload: {
        organizationId: string;
        clientId: string;
        actorId: string;
        actorName: string;
        imported: number;
        errors: number;
    }): Promise<void>;
}

interface Dependencies {
    authorizeClient(clientId: unknown, organizationId: unknown): Promise<ClientAuthorization>;
    createAccessSource(): BasecampProjectAccessSource;
    isConfigured(): boolean;
    getTodo(projectId: string, todoId: string): Promise<{
        id: string | number;
        title: string;
        description: string;
        due_on: string | null;
    } | null>;
    createWriter(): ImportWriter;
    now(): string;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function numericId(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) return null;
    const numeric = Number(normalized);
    return Number.isSafeInteger(numeric) && numeric > 0 ? normalized : null;
}

function validTask(value: unknown): value is ImportTaskPayload {
    if (!value || typeof value !== 'object') return false;
    const task = value as Record<string, unknown>;
    return numericId(task.basecampProjectId) !== null
        && numericId(task.basecampTodoId) !== null;
}

function chunk<T>(values: T[], size = 500): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

export function createBasecampImportTasksPost(dependencies: Dependencies) {
    return async function postBasecampImport(req: Request): Promise<Response> {
        try {
            const body = await req.json() as Record<string, unknown>;
            const tasks = body.tasks;
            if (!body.clientId || !body.organizationId || !Array.isArray(tasks) || tasks.length === 0) {
                return json({ error: 'clientId, organizationId, and tasks[] are required' }, 400);
            }
            if (!tasks.every(validTask)) {
                return json({ error: 'Every task requires valid Basecamp IDs' }, 400);
            }

            const authorization = await dependencies.authorizeClient(body.clientId, body.organizationId);
            if (!authorization.ok) {
                return json({ error: authorization.error }, authorization.status);
            }

            const accessSource = dependencies.createAccessSource();
            const projectIds = Array.from(new Set(tasks.map(task => numericId(task.basecampProjectId)!)));
            for (const projectId of projectIds) {
                const access = await authorizeBasecampProject(
                    {
                        userId: authorization.userId,
                        organizationId: authorization.organizationId,
                        projectId,
                    },
                    accessSource,
                );
                if (!access.ok) return json({ error: access.error }, access.status);
            }

            if (!dependencies.isConfigured()) {
                return json({ error: 'Basecamp not configured', configured: false }, 503);
            }

            const providerTodos = new Map<string, Awaited<ReturnType<Dependencies['getTodo']>>>();
            for (const task of tasks) {
                const projectId = numericId(task.basecampProjectId)!;
                const todoId = numericId(task.basecampTodoId)!;
                const providerTodo = await dependencies.getTodo(projectId, todoId);
                if (!providerTodo || String(providerTodo.id) !== todoId || !providerTodo.title?.trim()) {
                    return json({ error: 'Basecamp todo is not authorized' }, 403);
                }
                providerTodos.set(`${projectId}:${todoId}`, providerTodo);
            }

            const now = dependencies.now();
            const rows = tasks.map(task => {
                const projectId = numericId(task.basecampProjectId)!;
                const todoId = numericId(task.basecampTodoId)!;
                const providerTodo = providerTodos.get(`${projectId}:${todoId}`)!;
                return {
                    organization_id: authorization.organizationId,
                    client_id: authorization.clientId,
                    title: providerTodo.title.trim(),
                    description: providerTodo.description || null,
                    due_date: providerTodo.due_on || null,
                    priority: task.priority ?? 'medium',
                    status: 'todo',
                    category: task.category || null,
                    tags: [],
                    assignee_ids: [],
                    sort_order: 0,
                    basecamp_todo_id: Number(todoId),
                    basecamp_project_id: Number(projectId),
                    last_synced_at: now,
                    status_history: [{ status: 'todo', at: now, by: authorization.userId }],
                    custom_fields: {},
                    watcher_ids: [],
                    created_by: authorization.userId,
                };
            });

            const writer = dependencies.createWriter();
            const errors: string[] = [];
            let imported = 0;
            for (const part of chunk(rows)) {
                const error = await writer.insertTasks(part);
                if (error) errors.push(error);
                else imported += part.length;
            }

            if (imported > 0) {
                await writer.logActivity({
                    organizationId: authorization.organizationId,
                    clientId: authorization.clientId,
                    actorId: authorization.userId,
                    actorName: authorization.actorName,
                    imported,
                    errors: errors.length,
                });
            }

            return json({ imported, errors });
        } catch {
            return json({ error: 'Unable to import Basecamp tasks' }, 500);
        }
    };
}
