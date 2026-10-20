/**
 * Session tray for retainer warnings that are not on-screen toasts.
 * The notification bell already lists items; this store adds those rows
 * without writing a notifications table row.
 */

export interface RetainerTrayItem {
    id: string;
    clientId: string;
    title: string;
    body: string;
    createdAt: string;
    isRead: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let items: RetainerTrayItem[] = [];

function emit(): void {
    for (const listener of listeners) listener();
}

export function retainerTraySnapshot(): RetainerTrayItem[] {
    return items;
}

export function subscribeRetainerTray(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Replace the current warnings. A row the user already read stays read. */
export function syncRetainerTray(next: ReadonlyArray<Omit<RetainerTrayItem, 'isRead' | 'createdAt'> & { createdAt?: string }>): void {
    const previous = new Map(items.map(item => [item.id, item]));
    const now = new Date().toISOString();
    items = next.map(item => {
        const prior = previous.get(item.id);
        return {
            id: item.id,
            clientId: item.clientId,
            title: item.title,
            body: item.body,
            createdAt: prior?.createdAt ?? item.createdAt ?? now,
            isRead: prior?.isRead ?? false,
        };
    });
    emit();
}

export function markRetainerTrayRead(id: string): void {
    let changed = false;
    items = items.map(item => {
        if (item.id !== id || item.isRead) return item;
        changed = true;
        return { ...item, isRead: true };
    });
    if (changed) emit();
}

export function markRetainerTrayAllRead(): void {
    if (items.every(item => item.isRead)) return;
    items = items.map(item => item.isRead ? item : { ...item, isRead: true });
    emit();
}

export function resetRetainerTrayForTests(): void {
    items = [];
    emit();
}
