export interface QuickCreateSaveResult<T> {
    draft: T | null;
    shouldComplete: boolean;
    error: string | null;
}

export function resolveQuickCreateSave<T>(
    draft: T,
    saved: boolean,
): QuickCreateSaveResult<T> {
    if (saved) return { draft: null, shouldComplete: true, error: null };
    return {
        draft,
        shouldComplete: false,
        error: "Couldn't save this item. Check your connection and try again.",
    };
}
