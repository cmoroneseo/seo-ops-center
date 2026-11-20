import { numericId } from './import-tasks-route.ts';

export function parseBasecampTodoInput(value: unknown): { todoId: string; projectId: string | null } | null {
    const id = numericId(value);
    if (id) return { todoId: String(Number(id)), projectId: null };
    if (typeof value !== 'string') return null;

    try {
        const url = new URL(value.trim());
        if (url.origin !== 'https://3.basecamp.com' || url.username || url.password) return null;
        const path = /^\/\d+\/(?:buckets\/(\d+)\/)?todos\/(\d+)\/?$/.exec(url.pathname);
        if (!path) return null;
        const todoId = numericId(path[2]);
        const projectId = numericId(path[1]);
        if (!todoId || (path[1] && !projectId)) return null;
        return { todoId: String(Number(todoId)), projectId: projectId ? String(Number(projectId)) : null };
    } catch {
        return null;
    }
}
