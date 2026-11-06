/** Recent clients live in localStorage. Parsing stays pure so a bad value cannot throw. */

export const SELECTED_CLIENT_KEY = 'seo-ops.selectedClientId';
export const RECENT_CLIENTS_KEY = 'seo-ops.recentClientIds';
export const RECENT_CLIENT_LIMIT = 5;

export function parseIdList(raw: string | null, limit = RECENT_CLIENT_LIMIT): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        const ids: string[] = [];
        for (const value of parsed) {
            if (typeof value !== 'string') continue;
            const id = value.trim();
            if (!id || ids.includes(id)) continue;
            ids.push(id);
            if (ids.length >= limit) break;
        }
        return ids;
    } catch {
        return [];
    }
}

export function rememberClientId(current: readonly string[], id: string, limit = RECENT_CLIENT_LIMIT): string[] {
    const trimmed = id.trim();
    if (!trimmed) return current.slice(0, limit);
    return [trimmed, ...current.filter(item => item !== trimmed)].slice(0, limit);
}
