/**
 * Basecamp 3 API client.
 *
 * Authentication: Personal Access Token
 * Requires two environment variables:
 *   BASECAMP_ACCESS_TOKEN  — from https://launchpad.37signals.com/profile/tokens
 *   BASECAMP_ACCOUNT_ID    — the 8+ digit ID in your Basecamp URL
 *                            e.g. https://3.basecamp.com/1234567/ → 1234567
 *
 * All calls are server-side only (API routes / Server Actions).
 * Never import this file in client components.
 */

const BASE_URL = () => {
    const accountId = process.env.BASECAMP_ACCOUNT_ID;
    if (!accountId) throw new Error('BASECAMP_ACCOUNT_ID env var not set');
    return `https://3.basecamp.com/${accountId}/api/v1`;
};

function getHeaders(): Record<string, string> {
    const token = process.env.BASECAMP_ACCESS_TOKEN;
    if (!token) throw new Error('BASECAMP_ACCESS_TOKEN env var not set');
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Basecamp requires a User-Agent identifying the integration
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

/** List all active Basecamp projects */
export async function listBasecampProjects(): Promise<BasecampProject[]> {
    try {
        const res = await fetch(`${BASE_URL()}/projects.json`, {
            headers: getHeaders(),
            next: { revalidate: 300 }, // cache 5 min
        });
        if (!res.ok) throw new Error(`Basecamp projects fetch failed: ${res.status}`);
        const data = await res.json();
        return (data as BasecampProject[]).filter(p => p.status === 'active');
    } catch (err) {
        console.error('[Basecamp] listProjects error:', err);
        return [];
    }
}

/** List all todolists for a project */
export async function listBasecampTodolists(projectId: number | string): Promise<BasecampTodolist[]> {
    try {
        const res = await fetch(`${BASE_URL()}/projects/${projectId}/todolists.json`, {
            headers: getHeaders(),
            next: { revalidate: 300 },
        });
        if (!res.ok) throw new Error(`Basecamp todolists fetch failed: ${res.status}`);
        return await res.json() as BasecampTodolist[];
    } catch (err) {
        console.error('[Basecamp] listTodolists error:', err);
        return [];
    }
}

/** Create a todo in a Basecamp todolist. Returns the new todo's ID. */
export async function createBasecampTodo(
    projectId: number | string,
    todolistId: number | string,
    params: {
        content: string;
        dueOn?: string;    // YYYY-MM-DD
        description?: string;
    },
): Promise<{ id: number; appUrl: string } | null> {
    try {
        const body: Record<string, unknown> = { content: params.content };
        if (params.dueOn) body.due_on = params.dueOn;
        if (params.description) body.description = params.description;

        const res = await fetch(`${BASE_URL()}/projects/${projectId}/todolists/${todolistId}/todos.json`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body),
        });
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
        const res = await fetch(`${BASE_URL()}/projects/${projectId}/todos/${todoId}/completion.json`, {
            method: 'POST',
            headers: getHeaders(),
        });
        return res.ok;
    } catch (err) {
        console.error('[Basecamp] completeTodo error:', err);
        return false;
    }
}

/** Reopen (uncomplete) a Basecamp todo */
export async function reopenBasecampTodo(
    projectId: number | string,
    todoId: number | string,
): Promise<boolean> {
    try {
        const res = await fetch(`${BASE_URL()}/projects/${projectId}/todos/${todoId}/completion.json`, {
            method: 'DELETE',
            headers: getHeaders(),
        });
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
    body: string,
): Promise<number | null> {
    try {
        const res = await fetch(`${BASE_URL()}/projects/${projectId}/recordings/${todoId}/comments.json`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ content: body }),
        });
        if (!res.ok) throw new Error(`Basecamp createComment failed: ${res.status}`);
        const comment = await res.json() as { id: number };
        return comment.id;
    } catch (err) {
        console.error('[Basecamp] createComment error:', err);
        return null;
    }
}

/** Check if Basecamp credentials are configured */
export function isBasecampConfigured(): boolean {
    return !!(process.env.BASECAMP_ACCESS_TOKEN && process.env.BASECAMP_ACCOUNT_ID);
}
