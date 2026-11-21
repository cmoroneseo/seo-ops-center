function recordingId(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

/**
 * Parent recording on a to-do payload.
 * A step's parent is the to-do itself, which is not a list, so it is ignored.
 * A missing parent leaves the decision to the list id the import asked for.
 */
export function providerParentListId(todo: {
    parent?: { id?: unknown; type?: unknown } | null;
}): string | null {
    const parent = todo.parent;
    if (!parent || typeof parent !== 'object') return null;
    const type = typeof parent.type === 'string' ? parent.type : '';
    if (type === 'Todo' || type === 'Kanban::Step') return null;
    return recordingId(parent.id);
}
