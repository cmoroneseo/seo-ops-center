import { isTaskStage } from '../tasks/stage.ts';
import {
    authorizeBasecampProject,
    type BasecampProjectAccessSource,
} from './project-access.ts';
import {
    mergeBasecampTodoSteps,
    stepsForTodo,
    type BasecampTodoStep,
} from './todo-steps.ts';

export interface ImportTaskPayload {
    basecampTodoId: number;
    basecampProjectId: number;
    /** List the to-do was imported from. Stored so onboarding can be recognized later. */
    basecampTodolistId?: number;
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
    /** Checklist steps embedded on the to-do payload. Merged with `getSteps`. */
    steps?: unknown;
}

/**
 * A Basecamp step, shaped as a task row but not yet linked to its parent.
 * `parent_task_id` and `stage` are applied once the parent task exists, so
 * the child lands in the same stage and time rolls up to that parent.
 */
export interface ImportedStepDraft {
    parentBasecampTodoId: number;
    basecampStepId: number;
    row: Record<string, unknown>;
}

/** A task that already carries a Basecamp recording id (a to-do or a step). */
export interface ImportedRecording {
    id: string;
    basecampTodoId: number;
    stage: string | null;
    parentTaskId: string | null;
}

export type GetProviderTodo = (
    projectId: string,
    todoId: string,
) => Promise<ProviderTodo | null>;

/** Checklist steps for one to-do. An array, or anything else (treated as none). */
export type GetProviderSteps = (
    projectId: string,
    todoId: string,
) => Promise<unknown>;

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
    /**
     * Tasks in this client that already store one of these Basecamp recording
     * ids. Used so a second import links new steps to the existing parent
     * instead of inserting either again.
     */
    findRecordings?(
        organizationId: string,
        clientId: string,
        recordingIds: number[],
    ): Promise<ImportedRecording[]>;
}

interface Dependencies {
    authorizeClient(clientId: unknown, organizationId: unknown): Promise<ClientAuthorization>;
    createAccessSource(): BasecampProjectAccessSource;
    isConfigured(): boolean;
    getTodo: GetProviderTodo;
    /** Dedicated step list. Merged with steps embedded on the to-do. */
    getSteps?: GetProviderSteps;
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

function sourceTodolistId(value: unknown): string | null | 'invalid' {
    if (value === undefined || value === null || value === '') return null;
    return numericId(value) ?? 'invalid';
}

function validTask(value: unknown): value is ImportTaskPayload {
    if (!value || typeof value !== 'object') return false;
    const task = value as Record<string, unknown>;
    return numericId(task.basecampProjectId) !== null
        && numericId(task.basecampTodoId) !== null
        && sourceTodolistId(task.basecampTodolistId) !== 'invalid';
}

function chunk<T>(values: T[], size = 500): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function taskPriority(value: unknown): 'low' | 'medium' | 'high' | 'urgent' {
    return typeof value === 'string' && TASK_PRIORITIES.has(value)
        ? value as 'low' | 'medium' | 'high' | 'urgent'
        : 'medium';
}

function personIdsOf(assignees: Array<{ id: number | string }> | null | undefined): number[] {
    const ids: number[] = [];
    for (const assignee of assignees ?? []) {
        const id = Number(assignee?.id);
        if (Number.isSafeInteger(id) && id > 0) ids.push(id);
    }
    return ids;
}

function mappedAssigneeIds(
    assignees: Array<{ id: number | string }> | null | undefined,
    assigneesByPerson: Map<number, string>,
): string[] {
    return Array.from(new Set(
        (assignees ?? [])
            .map(assignee => assigneesByPerson.get(Number(assignee?.id)))
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ));
}

function mirroredCompletion(input: {
    mirror: boolean;
    completed?: boolean;
    completion?: { created_at?: string | null } | null;
    completedAt?: string | null;
    now: string;
}): { status: 'todo' | 'done'; completedAt: string | null } {
    const isDone = input.mirror && input.completed === true;
    return {
        status: isDone ? 'done' : 'todo',
        // The moment the work actually finished, not the moment it was
        // imported — otherwise every backfilled to-do reads as completed today.
        completedAt: isDone
            ? input.completion?.created_at || input.completedAt || input.now
            : null,
    };
}

/**
 * Steps from the dedicated list, filled in by whatever the to-do payload
 * already embedded. A failed list read keeps the embedded checklist.
 */
export async function loadProviderSteps(
    projectId: string,
    todoId: string,
    getSteps: GetProviderSteps | undefined,
    embedded: unknown,
): Promise<BasecampTodoStep[]> {
    let listed: unknown[] = [];
    if (getSteps) {
        try {
            const fetched = await getSteps(projectId, todoId);
            listed = Array.isArray(fetched) ? fetched : [];
        } catch {
            listed = [];
        }
    }
    const embeddedSteps = Array.isArray(embedded) ? embedded : [];
    return stepsForTodo(mergeBasecampTodoSteps([listed, embeddedSteps]), todoId);
}

function draftImportedStep(input: {
    step: BasecampTodoStep;
    index: number;
    parentBasecampTodoId: number;
    organizationId: string;
    clientId: string;
    userId: string;
    projectId: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    category: string | null;
    now: string;
    mirrorCompletion: boolean;
    assigneesByPerson: Map<number, string> | null;
}): ImportedStepDraft {
    const completion = mirroredCompletion({
        mirror: input.mirrorCompletion,
        completed: input.step.completed,
        completion: input.step.completion,
        completedAt: input.step.completed_at,
        now: input.now,
    });
    // Basecamp's position when it has one, otherwise the merged order.
    // sort_order is what the task list reads; position is the stage-column order.
    const order = input.step.position ?? input.index;
    return {
        parentBasecampTodoId: input.parentBasecampTodoId,
        basecampStepId: input.step.id,
        row: {
            organization_id: input.organizationId,
            client_id: input.clientId,
            title: input.step.title,
            description: null,
            due_date: input.step.due_on,
            priority: input.priority,
            status: completion.status,
            category: input.category,
            tags: [],
            assignee_ids: input.assigneesByPerson
                ? mappedAssigneeIds(input.step.assignees, input.assigneesByPerson)
                : [],
            sort_order: order,
            position: order,
            // The step's own recording id, in the same column outbound push
            // writes after it creates a step. Re-import and push both treat
            // a present id as "this checklist item already exists".
            basecamp_todo_id: input.step.id,
            basecamp_project_id: Number(input.projectId),
            last_synced_at: input.now,
            status_history: [{
                status: completion.status,
                at: completion.completedAt ?? input.now,
                by: input.userId,
            }],
            completed_at: completion.completedAt,
            custom_fields: {},
            watcher_ids: [],
            created_by: input.userId,
        },
    };
}

/**
 * Step rows for a to-do that is already a task. Assignees are mapped the
 * same way as the parent's: an unmapped Basecamp person is omitted.
 */
export async function draftsForSteps(input: {
    steps: readonly BasecampTodoStep[];
    parentBasecampTodoId: number;
    organizationId: string;
    clientId: string;
    userId: string;
    projectId: string;
    priority?: unknown;
    category?: string | null;
    now: string;
    mirrorCompletion: boolean;
    resolveAssignees?: (personIds: number[]) => Promise<Map<number, string>>;
}): Promise<ImportedStepDraft[]> {
    const personIds = Array.from(new Set(input.steps.flatMap(step => step.assignees.map(assignee => assignee.id))));
    let assigneesByPerson: Map<number, string> | null = null;
    if (input.resolveAssignees && personIds.length > 0) {
        assigneesByPerson = await input.resolveAssignees(personIds);
    }
    return input.steps.map((step, index) => draftImportedStep({
        step,
        index,
        parentBasecampTodoId: input.parentBasecampTodoId,
        organizationId: input.organizationId,
        clientId: input.clientId,
        userId: input.userId,
        projectId: input.projectId,
        priority: taskPriority(input.priority),
        category: input.category || null,
        now: input.now,
        mirrorCompletion: input.mirrorCompletion,
        assigneesByPerson,
    }));
}

/**
 * Attach step drafts to the parent task that now exists.
 * Already-imported recording ids are skipped. The child takes the parent's
 * stage. It has no start date and no recurrence, so it is a pillar subtask:
 * time logged on it rolls up to the parent instead of becoming its own block.
 */
export function linkImportedSteps(input: {
    drafts: ReadonlyArray<ImportedStepDraft>;
    parents: ReadonlyArray<{ basecampTodoId: number; taskId: string; stage: string | null }>;
    alreadyImportedStepIds: ReadonlySet<number>;
}): Array<Record<string, unknown>> {
    const parentByTodo = new Map(input.parents.map(parent => [parent.basecampTodoId, parent]));
    const seen = new Set<number>();
    const rows: Array<Record<string, unknown>> = [];
    for (const draft of input.drafts) {
        if (seen.has(draft.basecampStepId) || input.alreadyImportedStepIds.has(draft.basecampStepId)) continue;
        if (draft.basecampStepId === draft.parentBasecampTodoId) continue;
        const parent = parentByTodo.get(draft.parentBasecampTodoId);
        if (!parent) continue;
        seen.add(draft.basecampStepId);
        rows.push({
            ...draft.row,
            parent_task_id: parent.taskId,
            stage: isTaskStage(parent.stage) ? parent.stage : 'backlog',
        });
    }
    return rows;
}

function indexTopLevel(records: readonly ImportedRecording[]): Map<number, ImportedRecording> {
    const byTodo = new Map<number, ImportedRecording>();
    for (const record of records) {
        if (record.parentTaskId != null || byTodo.has(record.basecampTodoId)) continue;
        byTodo.set(record.basecampTodoId, record);
    }
    return byTodo;
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
    getSteps?: GetProviderSteps;
    now: string;
    options?: BasecampImportOptions;
}): Promise<
    | { ok: true; rows: Array<Record<string, unknown>>; steps: ImportedStepDraft[] }
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

    const stepsByKey = new Map<string, BasecampTodoStep[]>();
    for (const task of input.tasks) {
        const projectId = numericId(task.basecampProjectId)!;
        const todoId = numericId(task.basecampTodoId)!;
        const key = `${projectId}:${todoId}`;
        stepsByKey.set(key, await loadProviderSteps(
            projectId,
            todoId,
            input.getSteps,
            providerTodos.get(key)?.steps,
        ));
    }

    const mirrorCompletion = input.options?.mirrorCompletion === true;
    const resolveAssignees = input.options?.resolveAssignees;

    let assigneesByPerson = new Map<number, string>();
    if (resolveAssignees) {
        const personIds = Array.from(new Set([
            ...Array.from(providerTodos.values()).flatMap(todo => personIdsOf(todo.assignees)),
            ...Array.from(stepsByKey.values()).flat().flatMap(step => step.assignees.map(assignee => assignee.id)),
        ]));
        if (personIds.length > 0) {
            assigneesByPerson = await resolveAssignees(personIds);
        }
    }

    const steps: ImportedStepDraft[] = [];
    const rows = input.tasks.map(task => {
        const projectId = numericId(task.basecampProjectId)!;
        const todoId = numericId(task.basecampTodoId)!;
        const providerTodo = providerTodos.get(`${projectId}:${todoId}`)!;

        const completion = mirroredCompletion({
            mirror: mirrorCompletion,
            completed: providerTodo.completed,
            completion: providerTodo.completion,
            completedAt: providerTodo.completed_at,
            now: input.now,
        });
        const status = completion.status;
        const completedAt = completion.completedAt;

        const assigneeIds = resolveAssignees
            ? mappedAssigneeIds(providerTodo.assignees, assigneesByPerson)
            : [];
        const sourceListId = sourceTodolistId(task.basecampTodolistId);
        const priority = task.priority ?? 'medium';
        const category = task.category || null;

        for (const [index, step] of (stepsByKey.get(`${projectId}:${todoId}`) ?? []).entries()) {
            steps.push(draftImportedStep({
                step,
                index,
                parentBasecampTodoId: Number(todoId),
                organizationId: input.organizationId,
                clientId: input.clientId,
                userId: input.userId,
                projectId,
                priority,
                category,
                now: input.now,
                mirrorCompletion,
                assigneesByPerson: resolveAssignees ? assigneesByPerson : null,
            }));
        }

        return {
            organization_id: input.organizationId,
            client_id: input.clientId,
            title: providerTodo.title.trim(),
            description: providerTodo.description || null,
            due_date: providerTodo.due_on || null,
            priority,
            status,
            category,
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
            custom_fields: sourceListId && sourceListId !== 'invalid'
                ? { basecamp_source_todolist_id: sourceListId }
                : {},
            watcher_ids: [],
            created_by: input.userId,
        } satisfies Record<string, unknown>;
    });

    return { ok: true, rows, steps };
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
                getSteps: dependencies.getSteps,
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

            const writer = dependencies.createWriter();
            const recordingIds = [
                ...built.rows.map(row => Number(row.basecamp_todo_id)),
                ...built.steps.map(step => step.basecampStepId),
            ];
            const known = writer.findRecordings
                ? await writer.findRecordings(
                    authorization.organizationId,
                    authorization.clientId,
                    recordingIds,
                )
                : [];
            const parentsByTodo = indexTopLevel(known);
            const stepIds = new Set(built.steps.map(step => step.basecampStepId));
            const alreadyImportedStepIds = new Set(
                known.map(record => record.basecampTodoId).filter(id => stepIds.has(id)),
            );

            const errors: string[] = [];
            const insertedRows: Array<Record<string, unknown>> = [];
            const failedParentIds = new Set<number>();
            const newParentRows = built.rows.filter(row => !parentsByTodo.has(Number(row.basecamp_todo_id)));
            for (const part of chunk(newParentRows)) {
                const error = await writer.insertTasks(part);
                if (error) {
                    errors.push(error);
                    for (const row of part) failedParentIds.add(Number(row.basecamp_todo_id));
                } else {
                    // Only rows that actually landed. A failed chunk must not
                    // announce completions for work that was never imported.
                    insertedRows.push(...part);
                }
            }

            const insertedParentIds = insertedRows.map(row => Number(row.basecamp_todo_id));
            if (writer.findRecordings && insertedParentIds.length > 0) {
                const created = await writer.findRecordings(
                    authorization.organizationId,
                    authorization.clientId,
                    insertedParentIds,
                );
                for (const [todoId, record] of indexTopLevel(created)) {
                    parentsByTodo.set(todoId, record);
                }
            }

            const childRows = linkImportedSteps({
                drafts: built.steps,
                parents: [...parentsByTodo.entries()]
                    .filter(([todoId]) => !failedParentIds.has(todoId))
                    .map(([basecampTodoId, record]) => ({
                        basecampTodoId,
                        taskId: record.id,
                        stage: record.stage,
                    })),
                alreadyImportedStepIds,
            });
            for (const part of chunk(childRows)) {
                const error = await writer.insertTasks(part);
                if (error) errors.push(error);
                else insertedRows.push(...part);
            }

            const imported = insertedRows.length;

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
