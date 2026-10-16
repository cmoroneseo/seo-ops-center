/**
 * Importing a Basecamp to-do and linking a time entry to it, in one action.
 *
 * The case that forced this: a 0.4h entry, "Made revisions to XERF landing
 * page for client". The client's Basecamp project holds a to-do called
 * "XERF landing page" — assigned, and completed. The picker could not offer
 * it because it only searched SEO PM's `tasks`, so linking meant leaving the
 * review queue, importing the to-do by hand, and coming back.
 *
 * Two boundaries this route does not relax:
 *
 * 1. The CLIENT comes from the time log and the PROJECT comes from that
 *    client's server-owned config. Neither is ever read from the body — a
 *    caller-supplied project is exactly how a foreign to-do gets attached to
 *    billable time.
 * 2. The to-do is re-fetched from the provider and refused unless its id and
 *    title match, via the same `buildBasecampTaskRows` the bulk importer uses.
 *
 * Pure: the route wires Supabase and Basecamp, this decides.
 */

import {
    buildBasecampTaskRows,
    draftsForSteps,
    linkImportedSteps,
    loadProviderSteps,
    numericId,
    type GetProviderSteps,
    type GetProviderTodo,
    type ImportedStepDraft,
} from '../basecamp/import-tasks-route.ts';
import type { TaskSourceEntry, TasksAuthorization } from './import-tasks-route.ts';

export interface ImportBasecampTaskDependencies {
    authorize(organizationId: string): Promise<TasksAuthorization>;
    loadEntry(organizationId: string, timeLogId: string): Promise<TaskSourceEntry | null>;
    /** The client's Basecamp project, from server-owned client config. */
    resolveClientProjectId(organizationId: string, clientId: string): Promise<string | null>;
    /** The shared Basecamp project entitlement boundary. */
    authorizeProject(input: {
        userId: string;
        organizationId: string;
        projectId: string;
    }): Promise<boolean>;
    isConfigured(): boolean;
    getTodo: GetProviderTodo;
    /** Checklist steps for the to-do. Merged with any steps embedded on it. */
    getSteps?: GetProviderSteps;
    /**
     * Basecamp person id -> org member user id, the reverse of what the push
     * does. A person with no mapping is simply absent from the map.
     */
    resolveAssignees(
        organizationId: string,
        personIds: number[],
    ): Promise<Map<number, string>>;
    /** An already-imported task for this to-do, so a re-pick links rather than duplicates. */
    findImportedTask(
        organizationId: string,
        clientId: string,
        basecampTodoId: number,
    ): Promise<{ id: string; title: string; stage?: string | null; priority?: string | null } | null>;
    /**
     * Recording ids already stored on tasks in this client. A step id lives in
     * `basecamp_todo_id`, so a second import can skip it.
     */
    findImportedRecordings?(
        organizationId: string,
        clientId: string,
        basecampIds: number[],
    ): Promise<Array<{ basecampTodoId: number }>>;
    insertTask(row: Record<string, unknown>): Promise<{ id: string; title: string; stage?: string | null }>;
    logImport(payload: {
        organizationId: string;
        clientId: string;
        actorId: string;
        title: string;
        /**
         * When the to-do was completed at the provider, or null if it arrives
         * outstanding. A to-do imported already-done has to reach the client's
         * feed as a completion on the day it was finished — otherwise the only
         * trace of it is an import event dated today, and the work never shows
         * as completed at all.
         */
        completedAt: string | null;
        /**
         * False when the parent was already a task and this call only attached
         * steps. The parent import event is not written again.
         */
        recordImport?: boolean;
        /** Steps inserted by this call. Done ones are announced as completions. */
        steps?: Array<{ title: string; completedAt: string | null }>;
    }): Promise<void>;
    now(): string;
}

/** The completion moment on a built task row, if it imported as done. */
export function completedAtOf(row: Record<string, unknown>): string | null {
    const value = row.completed_at;
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function stepCompletions(rows: readonly Record<string, unknown>[]): Array<{ title: string; completedAt: string | null }> {
    return rows.map(row => ({
        title: String(row.title ?? ''),
        completedAt: completedAtOf(row),
    }));
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

function objectRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

/**
 * Insert the to-do's steps as children of `parentTaskId`.
 * Pass `drafts` when the caller already shaped them (the create path) so the
 * checklist is not fetched or assignee-mapped a second time.
 */
async function attachSteps(input: {
    dependencies: ImportBasecampTaskDependencies;
    organizationId: string;
    clientId: string;
    userId: string;
    projectId: string;
    todoId: string;
    parentTaskId: string;
    parentStage: string | null;
    priority: unknown;
    now: string;
    drafts?: readonly ImportedStepDraft[];
}): Promise<
    | { ok: true; rows: Array<Record<string, unknown>> }
    | { ok: false; status: number; error: string }
> {
    const drafts = input.drafts ?? await draftsForSteps({
        steps: await loadProviderSteps(
            input.projectId,
            input.todoId,
            input.dependencies.getSteps,
            undefined,
        ),
        parentBasecampTodoId: Number(input.todoId),
        organizationId: input.organizationId,
        clientId: input.clientId,
        userId: input.userId,
        projectId: input.projectId,
        priority: input.priority,
        category: null,
        now: input.now,
        mirrorCompletion: true,
        resolveAssignees: personIds => input.dependencies.resolveAssignees(
            input.organizationId,
            personIds,
        ),
    });
    if (drafts.length === 0) return { ok: true, rows: [] };

    const known = input.dependencies.findImportedRecordings
        ? await input.dependencies.findImportedRecordings(
            input.organizationId,
            input.clientId,
            drafts.map(draft => draft.basecampStepId),
        )
        : [];
    const rows = linkImportedSteps({
        drafts,
        parents: [{
            basecampTodoId: Number(input.todoId),
            taskId: input.parentTaskId,
            stage: input.parentStage,
        }],
        alreadyImportedStepIds: new Set(known.map(record => record.basecampTodoId)),
    });

    const inserted: Array<Record<string, unknown>> = [];
    try {
        for (const row of rows) {
            await input.dependencies.insertTask(row);
            inserted.push(row);
        }
    } catch {
        return { ok: false, status: 500, error: 'Could not import the Basecamp steps' };
    }
    return { ok: true, rows: inserted };
}

/**
 * POST /api/timesheets/imports/tasks/basecamp
 * Body: { organizationId, timeLogId, basecampTodoId }
 *
 * Returns the SEO PM task the caller should link the entry to. Linking itself
 * stays where it already lives — the same `task_id` patch every other pick
 * goes through — so migration 044's same-client RPC guard still has the last
 * word.
 */
export function createImportBasecampTaskPost(dependencies: ImportBasecampTaskDependencies) {
    return async function postImportBasecampTask(request: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid JSON' }, 400);
        }

        const input = objectRecord(body);
        const organizationId = typeof input.organizationId === 'string' ? input.organizationId : '';
        const timeLogId = typeof input.timeLogId === 'string' ? input.timeLogId.trim() : '';
        const todoId = numericId(input.basecampTodoId);

        if (!timeLogId) return json({ error: 'No entry selected' }, 400);
        if (!todoId) return json({ error: 'A valid Basecamp to-do is required' }, 400);

        const member = await dependencies.authorize(organizationId);
        if (!member.ok) return json({ error: member.error }, member.status);

        const entry = await dependencies.loadEntry(member.organizationId, timeLogId);
        if (!entry) return json({ error: 'Entry not found' }, 404);

        // The same ownership boundary the entries route enforces: RLS is
        // organization-scoped and cannot express "your own rows only".
        if (!member.isManager && entry.userId !== member.userId) {
            return json({ error: 'Forbidden' }, 403);
        }

        if (!entry.clientId) {
            return json({ error: 'Give this entry a client first' }, 409);
        }

        const projectId = await dependencies.resolveClientProjectId(
            member.organizationId,
            entry.clientId,
        );
        if (!projectId) {
            return json({ error: 'This client has no Basecamp project' }, 409);
        }

        const authorizedProject = await dependencies.authorizeProject({
            userId: member.userId,
            organizationId: member.organizationId,
            projectId,
        });
        if (!authorizedProject) return json({ error: 'Project is not authorized' }, 403);

        // A second pick of the same to-do links the task that already exists
        // rather than minting a duplicate under the same `basecamp_todo_id`.
        // Steps still refresh onto that task: a checklist added in Basecamp
        // after the first import has to arrive, and a repeat pick must not
        // duplicate the steps that already did.
        const existing = await dependencies.findImportedTask(
            member.organizationId,
            entry.clientId,
            Number(todoId),
        );
        if (existing) {
            if (dependencies.isConfigured()) {
                const attached = await attachSteps({
                    dependencies,
                    organizationId: member.organizationId,
                    clientId: entry.clientId,
                    userId: member.userId,
                    projectId,
                    todoId,
                    parentTaskId: existing.id,
                    parentStage: existing.stage ?? null,
                    priority: existing.priority,
                    now: dependencies.now(),
                });
                if (!attached.ok) return json({ error: attached.error }, attached.status);
                if (attached.rows.length > 0) {
                    try {
                        await dependencies.logImport({
                            organizationId: member.organizationId,
                            clientId: entry.clientId,
                            actorId: member.userId,
                            title: existing.title,
                            completedAt: null,
                            recordImport: false,
                            steps: stepCompletions(attached.rows),
                        });
                    } catch { /* logged upstream */ }
                }
            }
            return json({
                ok: true,
                taskId: existing.id,
                taskTitle: existing.title,
                clientId: entry.clientId,
                imported: false,
            });
        }

        if (!dependencies.isConfigured()) {
            return json({ error: 'Basecamp is not connected', configured: false }, 503);
        }

        const built = await buildBasecampTaskRows({
            tasks: [{ basecampTodoId: Number(todoId), basecampProjectId: Number(projectId) }],
            organizationId: member.organizationId,
            clientId: entry.clientId,
            userId: member.userId,
            getTodo: dependencies.getTodo,
            getSteps: dependencies.getSteps,
            now: dependencies.now(),
            options: {
                // A to-do finished in Basecamp must not arrive outstanding in
                // SEO PM — it would show as open work and skew task counts.
                mirrorCompletion: true,
                // Carry whoever did the work. An unmapped Basecamp person is
                // omitted, never guessed at.
                resolveAssignees: personIds => dependencies.resolveAssignees(
                    member.organizationId,
                    personIds,
                ),
            },
        });
        if (!built.ok) return json({ error: built.error }, built.status);

        let created: { id: string; title: string; stage?: string | null };
        try {
            created = await dependencies.insertTask(built.rows[0]);
        } catch {
            return json({ error: 'Could not import the Basecamp to-do' }, 500);
        }

        // The task exists either way; a failed audit write must not turn a
        // successful import into an error the reviewer has to retry. Logged
        // before steps so a step failure still records the parent's completion.
        try {
            await dependencies.logImport({
                organizationId: member.organizationId,
                clientId: entry.clientId,
                actorId: member.userId,
                title: created.title,
                completedAt: completedAtOf(built.rows[0]),
            });
        } catch { /* logged upstream */ }

        const attached = await attachSteps({
            dependencies,
            organizationId: member.organizationId,
            clientId: entry.clientId,
            userId: member.userId,
            projectId,
            todoId,
            parentTaskId: created.id,
            parentStage: created.stage ?? null,
            priority: built.rows[0].priority,
            now: dependencies.now(),
            drafts: built.steps,
        });
        if (!attached.ok) return json({ error: attached.error }, attached.status);
        if (attached.rows.some(row => completedAtOf(row))) {
            try {
                await dependencies.logImport({
                    organizationId: member.organizationId,
                    clientId: entry.clientId,
                    actorId: member.userId,
                    title: created.title,
                    completedAt: null,
                    recordImport: false,
                    steps: stepCompletions(attached.rows),
                });
            } catch { /* logged upstream */ }
        }

        return json({
            ok: true,
            taskId: created.id,
            taskTitle: created.title,
            clientId: entry.clientId,
            imported: true,
        }, 201);
    };
}
