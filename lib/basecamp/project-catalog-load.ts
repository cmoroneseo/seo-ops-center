export interface BasecampProjectCatalogLoadState {
    open: boolean;
    hasCatalog: boolean;
    isLoading: boolean;
    error: string | null;
}

/** A failed attempt settles until the user explicitly clears it by retry/reopen. */
export function shouldLoadBasecampProjectCatalog(
    state: BasecampProjectCatalogLoadState,
): boolean {
    return state.open
        && !state.hasCatalog
        && !state.isLoading
        && state.error === null;
}
