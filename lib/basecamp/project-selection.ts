export interface SelectableBasecampProject {
    id: string | number;
    name: string;
}

/** Recents remain unavailable until the server-authorized catalog succeeds. */
export function authorizedRecentProjects<T extends SelectableBasecampProject>(
    catalog: T[] | null,
    recents: SelectableBasecampProject[],
): T[] {
    if (!catalog) return [];
    const projectsById = new Map(catalog.map(project => [String(project.id), project]));
    return recents
        .map(recent => projectsById.get(String(recent.id)))
        .filter((project): project is T => project !== undefined);
}

/** Returns the canonical authorized ID or null; callers must not drill down on null. */
export function authorizedProjectId(
    catalog: SelectableBasecampProject[] | null,
    projectId: string | number | null | undefined,
): string | null {
    if (!catalog || projectId === null || projectId === undefined) return null;
    const requestedId = String(projectId);
    return catalog.some(project => String(project.id) === requestedId) ? requestedId : null;
}
