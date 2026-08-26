import type { BasecampProjectRoleKind } from '../types.ts';

/**
 * Which Basecamp projects we import, and what their time means.
 *
 * Replaces `clients.custom_fields.basecamp_timesheet_enabled` as the import
 * gate. That flag is the *outbound push* opt-in; reusing it for import meant
 * every project a teammate actually logged to was silently skipped.
 *
 * Matching is exact. A CSV export names its project rather than identifying
 * it, and near-matches are dangerous — "Pipe It Right" and "Pipe It Right
 * Plumbing" may or may not be the same engagement. Unknown is a review item;
 * a wrong client is a billing error.
 */

export interface ProjectRoleRecord {
    basecampProjectId: string;
    basecampProjectName: string | null;
    role: BasecampProjectRoleKind;
    clientId: string | null;
}

export interface ProjectResolution {
    kind: BasecampProjectRoleKind | 'unknown';
    clientId: string | null;
    /**
     * The id of the role record we matched, null when nothing matched.
     *
     * A CSV export names its project but carries no id, so this is often the
     * only place the id is recoverable. Downstream keys project roles by
     * `basecamp_project_id` — the queue read model to decide `isInternal`, and
     * migration 041 to force internal attribution — so dropping it here files
     * internal time as an unresolvable `no_client` exception.
     */
    basecampProjectId: string | null;
}

const UNKNOWN: ProjectResolution = { kind: 'unknown', clientId: null, basecampProjectId: null };

function normalize(name: string | null): string {
    return (name ?? '').trim().toLowerCase();
}

export function resolveProjectRole(
    roles: ProjectRoleRecord[],
    lookup: { projectId: string | null; projectName: string },
): ProjectResolution {
    // The id is authoritative when we have one; the name is a CSV fallback.
    const match = (lookup.projectId
        && roles.find(role => role.basecampProjectId === lookup.projectId))
        || roles.find(role => normalize(role.basecampProjectName) === normalize(lookup.projectName));

    if (!match) return UNKNOWN;

    return {
        kind: match.role,
        clientId: match.role === 'client' ? match.clientId : null,
        basecampProjectId: match.basecampProjectId,
    };
}
