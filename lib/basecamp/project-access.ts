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

function normalizeProjectId(value: string | number | null | undefined): string | null {
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
            .map(normalizeProjectId)
            .filter((id): id is string => id !== null),
    ));

    return {
        ok: true,
        organizationId,
        canEnumerateCatalog: false,
        allowedProjectIds,
    };
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
