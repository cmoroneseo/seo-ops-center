/**
 * Finding and creating the task an imported entry belongs to.
 *
 * A teammate's reviewed August notes repeatedly reference Basecamp to-dos, yet
 * none of his fourteen imported entries carry a task link: every one was
 * logged at the Basecamp PROJECT level, so the CSV has no to-do to attach.
 * The link has to be made here, during review.
 *
 * The Basecamp timesheet entry is never touched. It cannot be re-parented in
 * place, and deleting and recreating it would mint a new `basecamp_entry_id`
 * and destroy the dedupe identity the whole import rests on. The attribution
 * lives in `time_logs.task_id` and nowhere else.
 *
 * Pure: routes authorize and persist, this decides.
 */

export interface TaskCandidate {
    id: string;
    title: string;
    status: string;
}

/** The fields of the source entry that decide what may be created from it. */
export interface TaskSourceEntry {
    id: string;
    /** The org member the time belongs to, or null when nobody is mapped. */
    userId: string | null;
    clientId: string | null;
}

export type TasksAuthorization =
    | { ok: true; userId: string; organizationId: string; isManager: boolean }
    | { ok: false; status: number; error: string };

export interface ImportTasksDependencies {
    authorize(organizationId: string): Promise<TasksAuthorization>;
    searchTasks(scope: {
        organizationId: string;
        clientId: string;
        query: string;
        limit: number;
    }): Promise<TaskCandidate[]>;
    loadEntry(organizationId: string, timeLogId: string): Promise<TaskSourceEntry | null>;
    createTask(input: {
        organizationId: string;
        clientId: string;
        title: string;
        /** Becomes the to-do's Notes in Basecamp. */
        notes: string;
        assigneeUserId: string | null;
        createdBy: string;
    }): Promise<{ id: string }>;
}

/** Enough to pick from, few enough to render in a popover. */
export const TASK_SEARCH_LIMIT = 20;
export const MAX_TASK_TITLE_LENGTH = 200;

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

function objectRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

/**
 * GET /api/timesheets/imports/tasks?organizationId=&clientId=&q=
 *
 * Candidate tasks for one client. A client is required and authorized before
 * the query, so a member cannot use this to browse another client or tenant.
 */
export function createImportTasksGet(dependencies: ImportTasksDependencies) {
    return async function getImportTasks(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const organizationId = params.get('organizationId')?.trim() ?? '';
        const clientId = params.get('clientId')?.trim() ?? '';
        const query = params.get('q')?.trim() ?? '';

        const member = await dependencies.authorize(organizationId);
        if (!member.ok) return json({ error: member.error }, member.status);

        // An unmapped entry has no client, and therefore no safe set of tasks
        // to offer. Say so rather than returning an empty list that reads as
        // "this client has no tasks".
        if (!clientId) {
            return json({ error: 'Give this entry a client first', tasks: [] }, 400);
        }

        const tasks = await dependencies.searchTasks({
            organizationId: member.organizationId,
            clientId,
            query,
            limit: TASK_SEARCH_LIMIT,
        });

        return json({ tasks });
    };
}

/**
 * POST /api/timesheets/imports/tasks
 * Body: { organizationId, timeLogId, title, notes?, assigneeUserId? }
 *
 * The client is derived from the TIME LOG, never from the body: the whole
 * point of the link is attribution, and a caller-supplied client is exactly
 * how billable time ends up on the wrong one.
 */
export function createImportTasksPost(dependencies: ImportTasksDependencies) {
    return async function postImportTask(request: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid JSON' }, 400);
        }

        const input = objectRecord(body);
        const organizationId = typeof input.organizationId === 'string'
            ? input.organizationId
            : '';
        const timeLogId = typeof input.timeLogId === 'string' ? input.timeLogId.trim() : '';
        const title = (typeof input.title === 'string' ? input.title : '').trim();
        const notes = (typeof input.notes === 'string' ? input.notes : '').trim();
        const assigneeUserId = typeof input.assigneeUserId === 'string' && input.assigneeUserId
            ? input.assigneeUserId
            : null;

        if (!timeLogId) return json({ error: 'No entry selected' }, 400);
        if (!title) return json({ error: 'Give the task a title' }, 400);
        if (title.length > MAX_TASK_TITLE_LENGTH) {
            return json(
                { error: `A task title is at most ${MAX_TASK_TITLE_LENGTH} characters` },
                400,
            );
        }

        const member = await dependencies.authorize(organizationId);
        if (!member.ok) return json({ error: member.error }, member.status);

        const entry = await dependencies.loadEntry(member.organizationId, timeLogId);
        if (!entry) return json({ error: 'Entry not found' }, 404);

        // Same ownership boundary the entries route enforces: RLS is
        // organization-scoped and cannot express "your own rows only".
        if (!member.isManager && entry.userId !== member.userId) {
            return json({ error: 'Forbidden' }, 403);
        }

        if (!entry.clientId) {
            return json({ error: 'Give this entry a client first' }, 409);
        }

        const created = await dependencies.createTask({
            organizationId: member.organizationId,
            clientId: entry.clientId,
            title,
            notes,
            // Falls back to whoever the time belongs to, so the common case
            // needs nothing from the body at all.
            assigneeUserId: assigneeUserId ?? entry.userId,
            createdBy: member.userId,
        });

        return json({ ok: true, taskId: created.id, clientId: entry.clientId }, 201);
    };
}
