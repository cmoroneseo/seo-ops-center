/**
 * Basecamp 3 API client.
 *
 * Authentication: OAuth 2.0 Access Token
 * Requires environment variables:
 *   BASECAMP_ACCESS_TOKEN  — from /api/integrations/basecamp/connect flow
 *   BASECAMP_ACCOUNT_ID    — e.g. 5338018 (from https://3.basecampapi.com/5338018)
 *
 * All calls are server-side only (API routes / Server Actions).
 * Never import this file in client components.
 *
 * Basecamp 3 URL patterns:
 *   - Projects:   /projects.json
 *   - Todolists:  /buckets/{projectId}/todosets/{todosetId}/todolists.json
 *   - Todos:      /buckets/{projectId}/todolists/{todolistId}/todos.json
 *   - Complete:   /buckets/{projectId}/todos/{todoId}/completion.json
 *   - Comments:   /buckets/{projectId}/recordings/{recordingId}/comments.json
 */

const BASE_URL = () => {
    const accountId = process.env.BASECAMP_ACCOUNT_ID;
    if (!accountId) throw new Error('BASECAMP_ACCOUNT_ID env var not set');
    return `https://3.basecampapi.com/${accountId}`;
};

function getHeaders(): Record<string, string> {
    const token = process.env.BASECAMP_ACCESS_TOKEN;
    if (!token) throw new Error('BASECAMP_ACCESS_TOKEN env var not set');
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SEO Ops Center (seo@marketingempiregroup.com)',
    };
}

export interface BasecampProject {
    id: number;
    name: string;
    description: string;
    status: string;
}

export interface BasecampTodolist {
    id: number;
    title: string;
    name: string;
    todos_count: number;
}

export interface BasecampTodo {
    id: number;
    title: string;
    due_on: string | null;
    completed: boolean;
    url: string;
    app_url: string;
}

export interface BasecampTodoFull {
    id: number;
    title: string;
    due_on: string | null;
    completed: boolean;
    description: string;
    assignees: { name: string }[];
    app_url: string;
}

/** Check if Basecamp credentials are configured */
export function isBasecampConfigured(): boolean {
    return !!(process.env.BASECAMP_ACCESS_TOKEN && process.env.BASECAMP_ACCOUNT_ID);
}

/**
 * Parse the `Link` header returned by Basecamp to find the next page URL.
 * Format: <https://...>; rel="next", <https://...>; rel="last"
 */
function parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
}

/** List ALL active Basecamp projects, following pagination automatically. */
export async function listBasecampProjects(): Promise<BasecampProject[]> {
    const all: BasecampProject[] = [];
    let url: string | null = `${BASE_URL()}/projects.json`;

    try {
        while (url) {
            const res = await fetch(url, {
                headers: getHeaders(),
                // No Next.js cache here — we need fresh data for the UI dropdown
            });
            if (!res.ok) throw new Error(`Basecamp projects fetch failed: ${res.status}`);
            const page = await res.json() as BasecampProject[];
            all.push(...page);
            url = parseNextLink(res.headers.get('Link'));
        }
        return all.filter(p => p.status === 'active');
    } catch (err) {
        console.error('[Basecamp] listProjects error:', err);
        return all.filter(p => p.status === 'active'); // return whatever we got before failure
    }
}

/**
 * Fetch all todolists from a single todoset, following pagination.
 */
async function fetchTodolistsFromTodoset(projectId: number | string, todosetId: string): Promise<BasecampTodolist[]> {
    const results: BasecampTodolist[] = [];
    let url: string | null = `${BASE_URL()}/buckets/${projectId}/todosets/${todosetId}/todolists.json`;
    while (url) {
        const res = await fetch(url, { headers: getHeaders() });
        if (!res.ok) break;
        const page = await res.json() as BasecampTodolist[];
        results.push(...page);
        url = parseNextLink(res.headers.get('Link'));
    }
    return results;
}

/**
 * List all todolists for a project across ALL camps/todosets.
 * Basecamp projects can have multiple todosets (one per camp/group).
 * The dock lists every todoset — we fetch from all of them and combine.
 */
export async function listBasecampTodolists(projectId: number | string): Promise<BasecampTodolist[]> {
    try {
        // Step 1: get the project dock to find ALL todoset URLs
        const projectRes = await fetch(`${BASE_URL()}/projects/${projectId}.json`, {
            headers: getHeaders(),
        });
        if (!projectRes.ok) throw new Error(`Basecamp project fetch failed: ${projectRes.status}`);
        const project = await projectRes.json() as { dock: Array<{ name: string; enabled: boolean; url: string }> };

        // Find ALL enabled todosets (one per camp — projects can have many)
        const todosetDocks = (project.dock ?? []).filter(d => d.name === 'todoset' && d.enabled);
        if (todosetDocks.length === 0) return [];

        // Step 2: fetch todolists from every todoset in parallel
        const perTodoset = await Promise.all(
            todosetDocks.map(dock => {
                const todosetId = dock.url.split('/todosets/')[1]?.replace('.json', '');
                return todosetId ? fetchTodolistsFromTodoset(projectId, todosetId) : Promise.resolve([]);
            }),
        );
        return perTodoset.flat();
    } catch (err) {
        console.error('[Basecamp] listTodolists error:', err);
        return [];
    }
}

/** List all todos for a todolist, following pagination. Excludes completed by default. */
export async function listBasecampTodos(
    projectId: number | string,
    todolistId: number | string,
    includeCompleted = false,
): Promise<BasecampTodoFull[]> {
    const results: BasecampTodoFull[] = [];
    let url: string | null = `${BASE_URL()}/buckets/${projectId}/todolists/${todolistId}/todos.json`;
    try {
        while (url) {
            const res = await fetch(url, { headers: getHeaders() });
            if (!res.ok) break;
            const page = await res.json() as BasecampTodoFull[];
            results.push(...page);
            url = parseNextLink(res.headers.get('Link'));
        }
        return includeCompleted ? results : results.filter(t => !t.completed);
    } catch (err) {
        console.error('[Basecamp] listTodos error:', err);
        return results.filter(t => includeCompleted || !t.completed);
    }
}

/** Create a todo in a Basecamp todolist. Returns the new todo's ID and app URL. */
export async function createBasecampTodo(
    projectId: number | string,
    todolistId: number | string,
    params: {
        content: string;
        dueOn?: string;       // YYYY-MM-DD
        description?: string;
        assigneePersonIds?: number[];
    },
): Promise<{ id: number; appUrl: string } | null> {
    try {
        const body: Record<string, unknown> = { content: params.content };
        if (params.dueOn) body.due_on = params.dueOn;
        if (params.description) body.description = params.description;
        if (params.assigneePersonIds?.length) body.assignee_ids = params.assigneePersonIds;

        const res = await fetch(
            `${BASE_URL()}/buckets/${projectId}/todolists/${todolistId}/todos.json`,
            { method: 'POST', headers: getHeaders(), body: JSON.stringify(body) },
        );
        if (!res.ok) throw new Error(`Basecamp createTodo failed: ${res.status} ${await res.text()}`);
        const todo = await res.json() as BasecampTodo;
        return { id: todo.id, appUrl: todo.app_url };
    } catch (err) {
        console.error('[Basecamp] createTodo error:', err);
        return null;
    }
}

/** Mark a Basecamp todo as complete */
export async function completeBasecampTodo(
    projectId: number | string,
    todoId: number | string,
): Promise<boolean> {
    try {
        const res = await fetch(
            `${BASE_URL()}/buckets/${projectId}/todos/${todoId}/completion.json`,
            { method: 'POST', headers: getHeaders() },
        );
        return res.ok;
    } catch (err) {
        console.error('[Basecamp] completeTodo error:', err);
        return false;
    }
}

/** Reopen (un-complete) a Basecamp todo */
export async function reopenBasecampTodo(
    projectId: number | string,
    todoId: number | string,
): Promise<boolean> {
    try {
        const res = await fetch(
            `${BASE_URL()}/buckets/${projectId}/todos/${todoId}/completion.json`,
            { method: 'DELETE', headers: getHeaders() },
        );
        return res.ok;
    } catch (err) {
        console.error('[Basecamp] reopenTodo error:', err);
        return false;
    }
}

/** Post a comment on a Basecamp todo */
export async function createBasecampComment(
    projectId: number | string,
    todoId: number | string,
    content: string,
): Promise<number | null> {
    try {
        const res = await fetch(
            `${BASE_URL()}/buckets/${projectId}/recordings/${todoId}/comments.json`,
            { method: 'POST', headers: getHeaders(), body: JSON.stringify({ content }) },
        );
        if (!res.ok) throw new Error(`Basecamp createComment failed: ${res.status}`);
        const comment = await res.json() as { id: number };
        return comment.id;
    } catch (err) {
        console.error('[Basecamp] createComment error:', err);
        return null;
    }
}
