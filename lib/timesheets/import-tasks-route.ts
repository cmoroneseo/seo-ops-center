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

/**
 * A Basecamp to-do that is NOT yet a SEO PM task.
 *
 * The gap this closes: a 0.4h entry reading "Made revisions to XERF landing
 * page for client" had a to-do called "XERF landing page" sitting in the
 * client's Basecamp project — completed, assigned, and invisible to a picker
 * that only searched the `tasks` table. Linking meant leaving the queue,
 * importing by hand, and coming back.
 */
export interface BasecampTodoCandidate {
    /** The Basecamp to-do id, as digits. Not a SEO PM task id. */
    id: string;
    title: string;
    /**
     * The common case, not the exception: time is logged against work that is
     * already finished.
     */
    completed: boolean;
    dueOn: string | null;
    todolistTitle: string | null;
    projectId: string;
}

/** Why the Basecamp group is empty, so the UI can say so instead of lying. */
export type BasecampGroupReason =
    | 'ok'
    | 'not_requested'
    /** Most clients have no Basecamp project bound. Not an error. */
    | 'no_project'
    | 'not_configured'
    | 'not_authorized'
    | 'unavailable';

/**
 * The Basecamp side of the picker. Optional on purpose: without it the GET
 * still answers with SEO PM tasks, which is what "never block linking" means.
 */
export interface BasecampCandidateSource {
    /**
     * The client's Basecamp project, read from server-owned client config.
     * Never from the request — a browser-chosen project is exactly how a
     * to-do from another tenant would end up linked.
     */
    resolveClientProjectId(organizationId: string, clientId: string): Promise<string | null>;
    /** The same entitlement boundary every other Basecamp operation crosses. */
    authorizeProject(input: {
        userId: string;
        organizationId: string;
        projectId: string;
    }): Promise<boolean>;
    isConfigured(): boolean;
    /** Every to-do across every todolist in the project, completed included. */
    listProjectTodos(projectId: string): Promise<BasecampTodoCandidate[]>;
    /** `basecamp_todo_id`s already carried by a task in this organization. */
    listImportedTodoIds(organizationId: string): Promise<number[]>;
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
    basecamp?: BasecampCandidateSource;
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

/**
 * The Basecamp group is fetched once, when the picker opens, and filtered in
 * the browser — listing every todolist and its to-dos is several provider
 * calls and must not run per keystroke. The cap keeps that one fetch bounded.
 */
export const BASECAMP_TODO_LIMIT = 200;

/**
 * Which groups a GET should populate. The SEO PM search runs per keystroke;
 * the Basecamp listing runs once on open. Splitting them keeps the expensive
 * half off the typing path.
 */
export type ImportTaskGroups = 'all' | 'tasks' | 'basecamp';

function requestedGroups(value: string | null): ImportTaskGroups {
    return value === 'tasks' || value === 'basecamp' ? value : 'all';
}

async function loadBasecampCandidates(
    source: BasecampCandidateSource,
    member: { userId: string; organizationId: string },
    clientId: string,
): Promise<{ todos: BasecampTodoCandidate[]; reason: BasecampGroupReason }> {
    const projectId = await source.resolveClientProjectId(member.organizationId, clientId);
    // Most clients have no project bound. Say so; do not error.
    if (!projectId) return { todos: [], reason: 'no_project' };

    const authorized = await source.authorizeProject({
        userId: member.userId,
        organizationId: member.organizationId,
        projectId,
    });
    if (!authorized) return { todos: [], reason: 'not_authorized' };

    if (!source.isConfigured()) return { todos: [], reason: 'not_configured' };

    const [todos, importedIds] = await Promise.all([
        source.listProjectTodos(projectId),
        source.listImportedTodoIds(member.organizationId),
    ]);

    const alreadyImported = new Set(importedIds.map(id => String(id)));
    const offered = todos
        .filter(todo => !alreadyImported.has(String(todo.id)))
        .slice(0, BASECAMP_TODO_LIMIT);

    return { todos: offered, reason: 'ok' };
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

        const groups = requestedGroups(params.get('include'));

        const tasks = groups === 'basecamp'
            ? []
            : await dependencies.searchTasks({
                organizationId: member.organizationId,
                clientId,
                query,
                limit: TASK_SEARCH_LIMIT,
            });

        let basecampTodos: BasecampTodoCandidate[] = [];
        let reason: BasecampGroupReason = 'not_requested';
        if (groups !== 'tasks') {
            if (!dependencies.basecamp) {
                reason = 'not_configured';
            } else {
                try {
                    const loaded = await loadBasecampCandidates(
                        dependencies.basecamp,
                        member,
                        clientId,
                    );
                    basecampTodos = loaded.todos;
                    reason = loaded.reason;
                } catch {
                    // A provider outage must never block linking to a task
                    // that already exists in SEO PM.
                    basecampTodos = [];
                    reason = 'unavailable';
                }
            }
        }

        return json({
            tasks,
            basecampTodos,
            basecamp: { available: reason === 'ok', reason },
        });
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
