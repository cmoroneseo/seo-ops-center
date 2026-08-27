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
    numericId,
    type GetProviderTodo,
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
    ): Promise<{ id: string; title: string } | null>;
    insertTask(row: Record<string, unknown>): Promise<{ id: string; title: string }>;
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
    }): Promise<void>;
    now(): string;
}

/** The completion moment on a built task row, if it imported as done. */
export function completedAtOf(row: Record<string, unknown>): string | null {
    const value = row.completed_at;
    return typeof value === 'string' && value.length > 0 ? value : null;
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
        const existing = await dependencies.findImportedTask(
            member.organizationId,
            entry.clientId,
            Number(todoId),
        );
        if (existing) {
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

        let created: { id: string; title: string };
        try {
            created = await dependencies.insertTask(built.rows[0]);
        } catch {
            return json({ error: 'Could not import the Basecamp to-do' }, 500);
        }

        // The task exists either way; a failed audit write must not turn a
        // successful import into an error the reviewer has to retry.
        try {
            await dependencies.logImport({
                organizationId: member.organizationId,
                clientId: entry.clientId,
                actorId: member.userId,
                title: created.title,
                completedAt: completedAtOf(built.rows[0]),
            });
        } catch { /* logged upstream */ }

        return json({
            ok: true,
            taskId: created.id,
            taskTitle: created.title,
            clientId: entry.clientId,
            imported: true,
        }, 201);
    };
}
