import {
    authorizeBasecampProject,
    type BasecampProjectAccessSource,
} from './project-access.ts';

export interface ImportTaskPayload {
    basecampTodoId: number;
    basecampProjectId: number;
    category?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * What the provider tells us about a to-do.
 *
 * `completed`, `completion` and `assignees` are optional because the bulk
 * importer never read them: widening the shape must not force every existing
 * caller (or test double) to start supplying them.
 */
export interface ProviderTodo {
    id: string | number;
    title: string;
    description: string;
    due_on: string | null;
    completed?: boolean;
    /** Basecamp reports the completion moment here. */
    completion?: { created_at?: string | null } | null;
    completed_at?: string | null;
    assignees?: Array<{ id: number | string }> | null;
}

export type GetProviderTodo = (
    projectId: string,
    todoId: string,
) => Promise<ProviderTodo | null>;

/**
 * Deliberate departures from the bulk importer's defaults, both off unless a
 * caller asks. The bulk "import selected to-dos" screen keeps landing
 * everything as an unassigned `todo`; only the timesheet picker — which
 * imports work that is usually already finished — turns these on.
 */
export interface BasecampImportOptions {
    /**
     * Carry the provider's completion state (and its date) onto the new task,
     * so finished work does not arrive outstanding and skew task counts.
     */
    mirrorCompletion?: boolean;
    /**
     * Map Basecamp person ids back to org member user ids. An unmapped person
     * is omitted rather than guessed at.
     */
    resolveAssignees?(personIds: number[]): Promise<Map<number, string>>;
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
    /**
     * Completions for to-dos that arrived already finished.
     *
     * Separate from logActivity because the two answer different questions:
     * logActivity records that WE ran an import, today; this records that the
     * CLIENT'S work was finished, on the day it was actually finished.
     */
    logCompletions(payload: {
        organizationId: string;
        clientId: string;
        actorId: string;
        actorName?: string;
        completions: Array<{ title: string; completedAt: string }>;
    }): Promise<void>;
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
    getTodo: GetProviderTodo;
    createWriter(): ImportWriter;
    /**
     * Basecamp person id -> org member user id. Unmapped people are omitted.
     *
     * Takes the organization explicitly because it is the SERVER-derived one
     * from authorizeClient, never the organizationId on the request body.
     */
    resolveAssignees(organizationId: string, personIds: number[]): Promise<Map<number, string>>;
    now(): string;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function numericId(value: unknown): string | null {
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

/**
 * Verify each requested to-do against the provider, then shape the `tasks`
 * rows it becomes.
 *
 * Extracted so the timesheet picker's import-and-link can reuse the exact
 * verification the bulk route already performs — re-fetching every to-do and
 * refusing anything whose id or title does not match what was asked for —
 * without reimplementing it or inheriting the bulk route's body-supplied
 * client.
 */
export async function buildBasecampTaskRows(input: {
    tasks: ImportTaskPayload[];
    organizationId: string;
    clientId: string;
    userId: string;
    getTodo: GetProviderTodo;
    now: string;
    options?: BasecampImportOptions;
}): Promise<
    | { ok: true; rows: Array<Record<string, unknown>> }
    | { ok: false; status: number; error: string }
> {
    const providerTodos = new Map<string, ProviderTodo>();
    for (const task of input.tasks) {
        const projectId = numericId(task.basecampProjectId)!;
        const todoId = numericId(task.basecampTodoId)!;
        const providerTodo = await input.getTodo(projectId, todoId);
        if (!providerTodo || String(providerTodo.id) !== todoId || !providerTodo.title?.trim()) {
            return { ok: false, status: 403, error: 'Basecamp todo is not authorized' };
        }
        providerTodos.set(`${projectId}:${todoId}`, providerTodo);
    }

    const mirrorCompletion = input.options?.mirrorCompletion === true;
    const resolveAssignees = input.options?.resolveAssignees;

    let assigneesByPerson = new Map<number, string>();
    if (resolveAssignees) {
        const personIds = Array.from(new Set(
            Array.from(providerTodos.values())
                .flatMap(todo => todo.assignees ?? [])
                .map(assignee => Number(assignee?.id))
                .filter(id => Number.isSafeInteger(id) && id > 0),
        ));
        if (personIds.length > 0) {
            assigneesByPerson = await resolveAssignees(personIds);
        }
    }

    const rows = input.tasks.map(task => {
        const projectId = numericId(task.basecampProjectId)!;
        const todoId = numericId(task.basecampTodoId)!;
        const providerTodo = providerTodos.get(`${projectId}:${todoId}`)!;

        const isDone = mirrorCompletion && providerTodo.completed === true;
        const status = isDone ? 'done' : 'todo';
        // The moment the work actually finished, not the moment it was
        // imported — otherwise every backfilled to-do reads as completed today.
        const completedAt = isDone
            ? providerTodo.completion?.created_at || providerTodo.completed_at || input.now
            : null;

        const assigneeIds = resolveAssignees
            ? Array.from(new Set(
                (providerTodo.assignees ?? [])
                    .map(assignee => assigneesByPerson.get(Number(assignee?.id)))
                    .filter((id): id is string => typeof id === 'string' && id.length > 0),
            ))
            : [];

        return {
            organization_id: input.organizationId,
            client_id: input.clientId,
            title: providerTodo.title.trim(),
            description: providerTodo.description || null,
            due_date: providerTodo.due_on || null,
            priority: task.priority ?? 'medium',
            status,
            category: task.category || null,
            tags: [],
            assignee_ids: assigneeIds,
            sort_order: 0,
            basecamp_todo_id: Number(todoId),
            basecamp_project_id: Number(projectId),
            last_synced_at: input.now,
            // One entry for the state the task arrives in, stamped with when
            // that state happened — the same shape every other creator writes.
            status_history: [{ status, at: completedAt ?? input.now, by: input.userId }],
            completed_at: completedAt,
            custom_fields: {},
            watcher_ids: [],
            created_by: input.userId,
        } satisfies Record<string, unknown>;
    });

    return { ok: true, rows };
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

            const built = await buildBasecampTaskRows({
                tasks,
                organizationId: authorization.organizationId,
                clientId: authorization.clientId,
                userId: authorization.userId,
                getTodo: dependencies.getTodo,
                now: dependencies.now(),
                options: {
                    // A to-do already finished in Basecamp must not arrive
                    // outstanding here — it would show as open work, skew task
                    // counts, and never reach the client's feed as completed.
                    mirrorCompletion: true,
                    // Carry whoever did the work, so an imported completion is
                    // attributed rather than anonymous.
                    resolveAssignees: personIds => dependencies.resolveAssignees(
                        authorization.organizationId,
                        personIds,
                    ),
                },
            });
            if (!built.ok) return json({ error: built.error }, built.status);
            const rows = built.rows;

            const writer = dependencies.createWriter();
            const errors: string[] = [];
            const insertedRows: Array<Record<string, unknown>> = [];
            let imported = 0;
            for (const part of chunk(rows)) {
                const error = await writer.insertTasks(part);
                if (error) errors.push(error);
                else {
                    imported += part.length;
                    // Only rows that actually landed. A failed chunk must not
                    // announce completions for work that was never imported.
                    insertedRows.push(...part);
                }
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

                const completions = insertedRows
                    .map(row => ({ title: String(row.title ?? ''), completedAt: row.completed_at }))
                    .filter((entry): entry is { title: string; completedAt: string } => (
                        typeof entry.completedAt === 'string' && entry.completedAt.length > 0
                    ));
                if (completions.length > 0) {
                    // The task rows exist either way; a failed feed write must
                    // not turn a successful import into an error.
                    try {
                        await writer.logCompletions({
                            organizationId: authorization.organizationId,
                            clientId: authorization.clientId,
                            actorId: authorization.userId,
                            actorName: authorization.actorName,
                            completions,
                        });
                    } catch { /* logged upstream */ }
                }
            }

            return json({ imported, errors });
        } catch {
            return json({ error: 'Unable to import Basecamp tasks' }, 500);
        }
    };
}
