export interface BasecampProjectAccessSource {
    findMembership(
        userId: string,
        organizationId: string,
    ): Promise<{ organizationIsInternal: boolean } | null>;
    listConfiguredProjectIds(
        organizationId: string,
    ): Promise<Array<string | number | null | undefined>>;
}

export type BasecampProjectAccess =
    | { ok: false; status: 400 | 401 | 403; error: string }
    | {
        ok: true;
        organizationId: string;
        canEnumerateCatalog: boolean;
        allowedProjectIds: string[];
    };

export function normalizeBasecampProjectId(value: string | number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

export async function resolveBasecampProjectAccess(
    input: { userId: string | null | undefined; organizationId: string | null | undefined },
    source: BasecampProjectAccessSource,
): Promise<BasecampProjectAccess> {
    if (!input.userId) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const organizationId = input.organizationId?.trim();
    if (!organizationId) {
        return { ok: false, status: 400, error: 'organizationId required' };
    }

    const membership = await source.findMembership(input.userId, organizationId);
    if (!membership) {
        return { ok: false, status: 403, error: 'Forbidden' };
    }

    if (membership.organizationIsInternal) {
        return {
            ok: true,
            organizationId,
            canEnumerateCatalog: true,
            allowedProjectIds: [],
        };
    }

    const configuredIds = await source.listConfiguredProjectIds(organizationId);
    const allowedProjectIds = Array.from(new Set(
        configuredIds
            .map(normalizeBasecampProjectId)
            .filter((id): id is string => id !== null),
    ));

    return {
        ok: true,
        organizationId,
        canEnumerateCatalog: false,
        allowedProjectIds,
    };
}

export type BasecampProjectAuthorization =
    | { ok: false; status: 400 | 401 | 403; error: string }
    | {
        ok: true;
        organizationId: string;
        projectId: string;
        canEnumerateCatalog: boolean;
        allowedProjectIds: string[];
    };

/**
 * Shared server boundary for every Basecamp operation that accepts a project ID.
 * Membership and provider-project entitlement are resolved from server-owned
 * state; a browser-selected ID never authorizes itself.
 */
export async function authorizeBasecampProject(
    input: {
        userId: string | null | undefined;
        organizationId: string | null | undefined;
        projectId: string | number | null | undefined;
    },
    source: BasecampProjectAccessSource,
): Promise<BasecampProjectAuthorization> {
    const access = await resolveBasecampProjectAccess(input, source);
    if (!access.ok) return access;

    const projectId = normalizeBasecampProjectId(input.projectId);
    if (!projectId) {
        return { ok: false, status: 400, error: 'Valid projectId required' };
    }

    if (!access.canEnumerateCatalog && !access.allowedProjectIds.includes(projectId)) {
        return { ok: false, status: 403, error: 'Project is not authorized' };
    }

    return { ...access, projectId };
}

export function scopeBasecampProjects<T extends { id: string | number }>(
    projects: T[],
    access: BasecampProjectAccess,
): T[] {
    if (!access.ok) return [];
    if (access.canEnumerateCatalog) return projects;

    const allowedIds = new Set(access.allowedProjectIds);
    return projects.filter(project => allowedIds.has(String(project.id)));
}
