/**
 * Sidebar client rows open the client page itself.
 * The tasks board is the one exception: it stays on /tasks and filters there.
 */

export function clientListHref(pathname: string, clientId: string): string {
    const id = encodeURIComponent(clientId);
    if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return `/tasks?client=${id}`;
    return `/workspace/${id}`;
}

export function activeClientId(pathname: string, clientQuery: string | null): string | null {
    const match = pathname.match(/^\/workspace\/([^/]+)/);
    if (match?.[1]) {
        try {
            return decodeURIComponent(match[1]);
        } catch {
            return match[1];
        }
    }
    if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return clientQuery;
    return null;
}

/** At least 32px tall, with a visible hover and a distinct active treatment. */
export function clientListRowClass(active: boolean): string {
    const base = 'group flex min-h-8 w-full flex-col justify-center gap-0.5 rounded-lg px-3 py-2 transition-colors';
    return active
        ? `${base} bg-primary/15 text-primary ring-1 ring-inset ring-primary/40`
        : `${base} text-foreground hover:bg-accent hover:text-accent-foreground`;
}
