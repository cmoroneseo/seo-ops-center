import type { ReportRow } from './reportStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Mode = 'read' | 'write';

export type Denied = { ok: false; status: 400 | 401 | 403 | 404 | 500; error: string };

export interface OrgMember {
    userId: string;
    actorName: string;
    organizationId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    isManager: boolean;
}

export type OrgMemberResult = { ok: true } & OrgMember | Denied;

export interface ReportAccessDeps {
    getReport(id: string): Promise<ReportRow | null>;
    requireOrganizationMember(organizationId: unknown): Promise<OrgMemberResult>;
}

export type ReportAccess =
    | { ok: true; report: ReportRow; auth: OrgMember }
    | Denied;

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID.test(value);
}

/**
 * Load a report and prove the caller belongs to its organization.
 * A missing id and a cross-org id both look like "not found".
 */
export async function requireReportAccess(
    id: unknown,
    mode: Mode,
    deps: ReportAccessDeps,
): Promise<ReportAccess> {
    if (!isUuid(id)) return { ok: false, status: 404, error: 'Not found' };

    const report = await deps.getReport(id);
    if (!report) return { ok: false, status: 404, error: 'Not found' };

    const auth = await deps.requireOrganizationMember(report.organization_id);
    if (!auth.ok) {
        if (auth.status === 401 || auth.status === 500) return auth;
        return { ok: false, status: 404, error: 'Not found' };
    }
    if (mode === 'write' && auth.role === 'viewer') {
        return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true, report, auth };
}

export async function requireOrgAccess(
    orgId: unknown,
    mode: Mode,
    deps: Pick<ReportAccessDeps, 'requireOrganizationMember'>,
): Promise<{ ok: true; auth: OrgMember } | Denied> {
    const auth = await deps.requireOrganizationMember(orgId);
    if (!auth.ok) return auth;
    if (mode === 'write' && auth.role === 'viewer') {
        return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true, auth };
}
