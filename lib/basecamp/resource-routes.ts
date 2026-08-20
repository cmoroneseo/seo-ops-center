import {
    authorizeBasecampProject,
    type BasecampProjectAccessSource,
} from './project-access.ts';

interface BasecampTodolist {
    id: string | number;
    title: string;
    name: string;
    todos_count: number;
}

interface BasecampTodo {
    id: string | number;
    title: string;
    due_on: string | null;
    completed: boolean;
    description: string;
    assignees: Array<{ id?: number; name: string }>;
    app_url: string;
}

interface CommonDependencies {
    getUserId(): Promise<string | null>;
    createAccessSource(): BasecampProjectAccessSource;
    isConfigured(): boolean;
    listTodolists(projectId: string): Promise<BasecampTodolist[]>;
}

interface TodosDependencies extends CommonDependencies {
    listTodos(projectId: string, todolistId: string, includeCompleted: boolean): Promise<BasecampTodo[]>;
}

interface TimesheetDependencies extends CommonDependencies {
    getTimesheetEnabled(projectId: string): Promise<boolean | null>;
    findTimesheetRecordingId(projectId: string): Promise<number | null>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function numericId(value: string | null): string | null {
    const normalized = value?.trim();
    return normalized && /^\d+$/.test(normalized) ? normalized : null;
}

async function authorizeRequest(req: Request, dependencies: CommonDependencies) {
    const userId = await dependencies.getUserId();
    if (!userId) return { ok: false as const, response: json({ error: 'Unauthorized' }, 401) };

    const params = new URL(req.url).searchParams;
    const organizationId = params.get('organizationId')?.trim();
    if (!organizationId) {
        return { ok: false as const, response: json({ error: 'organizationId required' }, 400) };
    }

    const projectId = params.get('projectId');
    const access = await authorizeBasecampProject(
        { userId, organizationId, projectId },
        dependencies.createAccessSource(),
    );
    if (!access.ok) {
        return { ok: false as const, response: json({ error: access.error }, access.status) };
    }

    return { ok: true as const, access, params };
}

export function createBasecampTodolistsGet(dependencies: CommonDependencies) {
    return async function getBasecampTodolists(req: Request): Promise<Response> {
        try {
            const authorization = await authorizeRequest(req, dependencies);
            if (!authorization.ok) return authorization.response;

            if (!dependencies.isConfigured()) {
                return json({ error: 'Basecamp not configured', configured: false }, 503);
            }

            const todolists = await dependencies.listTodolists(authorization.access.projectId);
            return json({ todolists });
        } catch {
            return json({ error: 'Unable to verify Basecamp project access' }, 500);
        }
    };
}

export function createBasecampTodosGet(dependencies: TodosDependencies) {
    return async function getBasecampTodos(req: Request): Promise<Response> {
        try {
            const authorization = await authorizeRequest(req, dependencies);
            if (!authorization.ok) return authorization.response;

            const todolistId = numericId(authorization.params.get('todolistId'));
            if (!todolistId) {
                return json({ error: 'Valid todolistId required' }, 400);
            }

            if (!dependencies.isConfigured()) {
                return json({ error: 'Basecamp not configured', configured: false }, 503);
            }

            const todolists = await dependencies.listTodolists(authorization.access.projectId);
            if (!todolists.some(list => String(list.id) === todolistId)) {
                return json({ error: 'Todolist is not authorized' }, 403);
            }

            const todos = await dependencies.listTodos(
                authorization.access.projectId,
                todolistId,
                true,
            );
            return json({ todos });
        } catch {
            return json({ error: 'Unable to verify Basecamp project access' }, 500);
        }
    };
}

export function createBasecampTimesheetGet(dependencies: TimesheetDependencies) {
    return async function getBasecampTimesheet(req: Request): Promise<Response> {
        try {
            const authorization = await authorizeRequest(req, dependencies);
            if (!authorization.ok) return authorization.response;

            if (!dependencies.isConfigured()) {
                return json({ error: 'Basecamp not configured', configured: false }, 503);
            }

            const timesheetEnabled = await dependencies.getTimesheetEnabled(
                authorization.access.projectId,
            );
            const recordingId = timesheetEnabled
                ? await dependencies.findTimesheetRecordingId(authorization.access.projectId)
                : null;
            return json({
                timesheetEnabled: timesheetEnabled ?? false,
                recordingFound: recordingId !== null,
            });
        } catch {
            return json({ error: 'Unable to verify Basecamp project access' }, 500);
        }
    };
}
