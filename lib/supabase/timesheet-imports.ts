import { createAdminClient } from './admin';
import type { ProjectRoleRecord } from '@/lib/basecamp/project-roles';
import type { BasecampProjectRoleKind } from '@/lib/types';

/** Service-role adapters for the import pipeline. */

export async function listProjectRoles(
    organizationId: string,
): Promise<ProjectRoleRecord[]> {
    const { data, error } = await createAdminClient()
        .from('basecamp_project_roles')
        .select('basecamp_project_id, basecamp_project_name, role, client_id')
        .eq('organization_id', organizationId);
    if (error) throw error;

    return (data ?? []).map(row => ({
        basecampProjectId: String(row.basecamp_project_id),
        basecampProjectName: row.basecamp_project_name ?? null,
        role: row.role as BasecampProjectRoleKind,
        clientId: row.client_id ?? null,
    }));
}

export async function startImportRun(input: {
    organizationId: string;
    requestedBy: string;
    userId: string;
    from: string;
    to: string;
}): Promise<{ id: string }> {
    const { data, error } = await createAdminClient()
        .from('timesheet_import_runs')
        .insert({
            organization_id: input.organizationId,
            requested_by: input.requestedBy,
            user_id: input.userId,
            range_start: input.from,
            range_end: input.to,
            source: 'csv',
            status: 'running',
        })
        .select('id')
        .single();
    if (error) throw error;
    return { id: data.id };
}

export async function finishImportRun(
    id: string,
    patch: Record<string, unknown>,
): Promise<void> {
    const { error } = await createAdminClient()
        .from('timesheet_import_runs')
        .update({ ...patch, finished_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}
