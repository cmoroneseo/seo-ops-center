/**
 * Retainer burn alerts.
 *
 * A toast is only for the client currently in context (the open workspace,
 * otherwise the running timer). Every other client goes to the notification
 * tray. A toast that has already been shown this session is not shown again
 * after a navigation — it moves to the tray instead.
 */

export const RETAINER_WARNING_FLOOR = 0.8;

export interface RetainerUsageClient {
    id: string;
    name: string;
    seoHours: number;
    status: string;
    /** Custom setup has no monthly retainer, so it never warns. */
    customScope: boolean;
}

export interface RetainerWarning {
    id: string;
    clientId: string;
    clientName: string;
    percent: number;
    logged: number;
    budget: number;
    message: string;
    sub: string;
}

const SHOWN_KEY = 'timer:retainer_shown_session';

/** Survives a remount when sessionStorage is blocked. */
const shownMemory = new Set<string>();

export function retainerWarningId(clientId: string, month: string): string {
    return `retainer:${clientId}:${month}`;
}

export function retainerWarnings(
    clients: readonly RetainerUsageClient[],
    loggedByClient: Readonly<Record<string, number>>,
    month: string,
): RetainerWarning[] {
    if (!month) return [];
    const warnings: RetainerWarning[] = [];
    for (const client of clients) {
        if (client.customScope || !client.seoHours || client.status !== 'Active') continue;
        const logged = loggedByClient[client.id] ?? 0;
        const ratio = logged / client.seoHours;
        if (ratio < RETAINER_WARNING_FLOOR || ratio >= 1) continue;
        const percent = Math.round(ratio * 100);
        const remaining = client.seoHours - logged;
        warnings.push({
            id: retainerWarningId(client.id, month),
            clientId: client.id,
            clientName: client.name,
            percent,
            logged,
            budget: client.seoHours,
            message: `${client.name} is at ${percent}% of their monthly retainer.`,
            sub: `${logged}h logged of ${client.seoHours}h — ${remaining.toFixed(1)}h remaining.`,
        });
    }
    return warnings;
}

/** Workspace route wins. The running timer is the context when no client is open. */
export function retainerContextClientId(pathname: string | null | undefined, timerClientId: string | null | undefined): string | null {
    const open = workspaceClientId(pathname);
    if (open) return open;
    return timerClientId || null;
}

export function workspaceClientId(pathname: string | null | undefined): string | null {
    if (!pathname) return null;
    const match = pathname.match(/^\/workspace\/([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

export function partitionRetainerWarnings(input: {
    warnings: readonly RetainerWarning[];
    contextClientId: string | null;
    dismissedIds: ReadonlySet<string>;
    shownIds: ReadonlySet<string>;
}): { toast: RetainerWarning | null; tray: RetainerWarning[] } {
    const visible = input.warnings.filter(warning => !input.dismissedIds.has(warning.id));
    const toast = input.contextClientId
        ? visible.find(warning => warning.clientId === input.contextClientId && !input.shownIds.has(warning.id)) ?? null
        : null;
    return {
        toast,
        tray: visible.filter(warning => warning.id !== toast?.id),
    };
}

/**
 * Once a toast is marked shown it would otherwise fall into the tray on the
 * next check. Keep it on screen while the user is still with that client.
 */
export function retainVisibleRetainerToast(
    toast: RetainerWarning | null,
    current: RetainerWarning | null,
    contextClientId: string | null,
    dismissedIds: ReadonlySet<string>,
): RetainerWarning | null {
    if (toast) return toast;
    if (current && current.clientId === contextClientId && !dismissedIds.has(current.id)) return current;
    return null;
}

function canUseSessionStorage(): boolean {
    return typeof sessionStorage !== 'undefined';
}

export function readRetainerShownIds(): Set<string> {
    const ids = new Set(shownMemory);
    if (!canUseSessionStorage()) return ids;
    try {
        const raw = sessionStorage.getItem(SHOWN_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
            for (const id of parsed) {
                if (typeof id === 'string' && id) ids.add(id);
            }
        }
    } catch {
        /* keep the in-memory set */
    }
    return ids;
}

export function rememberRetainerShown(id: string): void {
    if (!id) return;
    shownMemory.add(id);
    if (!canUseSessionStorage()) return;
    try {
        const ids = [...readRetainerShownIds()];
        sessionStorage.setItem(SHOWN_KEY, JSON.stringify(ids));
    } catch {
        /* in-memory set still suppresses a remount in this document */
    }
}

/** Test hook. Production never needs to forget a session. */
export function resetRetainerShownForTests(): void {
    shownMemory.clear();
    if (!canUseSessionStorage()) return;
    try { sessionStorage.removeItem(SHOWN_KEY); } catch { /* ignore */ }
}
