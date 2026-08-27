import { createAdminClient } from './admin';
import type { ProjectRoleRecord } from '@/lib/basecamp/project-roles';
import type { BasecampProjectRoleKind } from '@/lib/types';
import type { QueueSourceRow } from '@/lib/timesheets/import-queue-route';
import { parseReferenceLinks } from '@/lib/timesheets/reference-links';

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

interface ImportQueueDatabaseRow {
    id: string;
    user_id: string | null;
    client_id: string | null;
    activity_keys: string[] | null;
    reference_links: unknown;
    task_id: string | null;
    import_status: QueueSourceRow['importStatus'] | null;
    date: string;
    hours: number | string | null;
    description: string | null;
    counts_toward_budget: boolean | null;
    review_note: string | null;
    basecamp_project_id: number | string | null;
    clients: { name: string } | null;
    tasks: { title: string } | null;
}

const QUEUE_SELECT = `
    id, user_id, client_id, activity_keys, reference_links, task_id, import_status, date, hours,
    description, counts_toward_budget, review_note, basecamp_project_id,
    clients(name), tasks(title)
`;

export function mapImportQueueRow(
    row: ImportQueueDatabaseRow,
    projectRoles: Map<string, ProjectRoleRecord>,
): QueueSourceRow {
    const role = projectRoles.get(String(row.basecamp_project_id ?? ''));
    const isInternal = role?.role === 'internal';
    const hours = Number(row.hours);

    return {
        id: row.id,
        userId: row.user_id,
        clientId: isInternal ? null : row.client_id ?? null,
        clientName: isInternal ? null : row.clients?.name ?? null,
        // Internal is a property of the project, not of the entry.
        isInternal,
        activityKeys: row.activity_keys ?? [],
        // Defensive on purpose: this is a jsonb column, so the shape is a
        // claim rather than a guarantee.
        referenceLinks: parseReferenceLinks(row.reference_links),
        taskId: row.task_id ?? null,
        taskTitle: row.tasks?.title ?? null,
        importStatus: row.import_status ?? 'needs_context',
        date: row.date,
        hours: Number.isFinite(hours) ? hours : 0,
        description: row.description ?? '',
        // Internal time never consumes a client's deliverable budget.
        countsTowardBudget: !isInternal && row.counts_toward_budget !== false,
        basecampProjectName: role?.basecampProjectName ?? null,
        reviewNote: row.review_note ?? null,
    };
}

/** Rows still moving through review. Approved and voided rows are excluded. */
export async function listImportQueue(scope: {
    organizationId: string;
    userId: string | null;
}): Promise<QueueSourceRow[]> {
    const admin = createAdminClient();

    let query = admin
        .from('time_logs')
        .select(QUEUE_SELECT)
        .eq('organization_id', scope.organizationId)
        .in('import_status', ['needs_context', 'pending_review'])
        .order('date', { ascending: true });
    if (scope.userId) query = query.eq('user_id', scope.userId);

    const { data, error } = await query;
    if (error) throw error;

    const roles = await listProjectRoles(scope.organizationId);
    const byProject = new Map(roles.map(role => [role.basecampProjectId, role]));

    return (data as unknown as ImportQueueDatabaseRow[] ?? []).map(row =>
        mapImportQueueRow(row, byProject),
    );
}

/** Load the rows a transition is about, scoped to one organization. */
export async function loadQueueRowsByIds(
    organizationId: string,
    ids: string[],
): Promise<QueueSourceRow[]> {
    if (ids.length === 0) return [];
    const rows = await listImportQueue({ organizationId, userId: null });
    const wanted = new Set(ids);
    return rows.filter(row => wanted.has(row.id));
}

/** Resolve a client only inside the authenticated organization. */
export async function clientBelongsToOrganization(
    organizationId: string,
    clientId: string,
): Promise<boolean> {
    const { data, error } = await createAdminClient()
        .from('clients')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('id', clientId)
        .maybeSingle();
    if (error) throw error;
    return data !== null;
}

/** Apply one all-or-none patch through the transactional database RPC. */
export async function applyQueueUpdate(
    organizationId: string,
    ids: string[],
    updates: Record<string, unknown>,
    expectedStatus: string,
    authorizedUserId: string | null,
): Promise<number> {
    if (ids.length === 0) return 0;
    const { data, error } = await createAdminClient().rpc(
        'apply_timesheet_import_transition',
        {
            p_organization_id: organizationId,
            p_ids: ids,
            p_authorized_user_id: authorizedUserId,
            p_expected_status: expectedStatus,
            p_updates: updates,
        },
    );
    if (error?.code === 'P0001') return 0;
    if (error) throw error;

    const changed = Number(data);
    return Number.isInteger(changed) ? changed : 0;
}

/** Resolve a task only inside the authenticated organization, with its client. */
export async function taskBelongsToOrganization(
    organizationId: string,
    taskId: string,
): Promise<{ clientId: string | null } | null> {
    const { data, error } = await createAdminClient()
        .from('tasks')
        .select('id, client_id')
        .eq('organization_id', organizationId)
        .eq('id', taskId)
        .maybeSingle();
    if (error) throw error;
    return data ? { clientId: data.client_id ?? null } : null;
}

/** Candidate tasks for one client, optionally narrowed by a search term. */
export async function searchClientTasks(scope: {
    organizationId: string;
    clientId: string;
    query: string;
    limit: number;
}): Promise<Array<{ id: string; title: string; status: string }>> {
    let query = createAdminClient()
        .from('tasks')
        .select('id, title, status')
        .eq('organization_id', scope.organizationId)
        .eq('client_id', scope.clientId);
    if (scope.query) {
        // Escaped: `%`, `_` and `,` are all meaningful to PostgREST's filter
        // grammar, and a search box is user input.
        const term = scope.query.replace(/[%_,()\\]/g, '');
        if (term) query = query.ilike('title', `%${term}%`);
    }

    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(scope.limit);
    if (error) throw error;

    return (data ?? []).map(task => ({
        id: task.id,
        title: task.title ?? '',
        status: task.status ?? 'todo',
    }));
}

/**
 * The entry a task is being created from.
 *
 * Read straight from `time_logs` rather than through the review queue: the
 * ownership check and the client derivation must see the stored row, not a
 * projection that has already blanked the client for internal projects.
 */
export async function loadImportEntryForTask(
    organizationId: string,
    timeLogId: string,
): Promise<{ id: string; userId: string | null; clientId: string | null } | null> {
    const { data, error } = await createAdminClient()
        .from('time_logs')
        .select('id, user_id, client_id')
        .eq('organization_id', organizationId)
        .eq('id', timeLogId)
        .in('import_status', ['needs_context', 'pending_review'])
        .maybeSingle();
    if (error) throw error;
    return data
        ? { id: data.id, userId: data.user_id ?? null, clientId: data.client_id ?? null }
        : null;
}

/** Create the SEO PM task an imported entry will be attributed to. */
export async function createTaskFromImportEntry(input: {
    organizationId: string;
    clientId: string;
    title: string;
    notes: string;
    assigneeUserId: string | null;
    createdBy: string;
}): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const { data, error } = await createAdminClient()
        .from('tasks')
        .insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            title: input.title,
            // The Basecamp push already forwards `task.description` into the
            // to-do's Notes; it was simply never being given one, which is why
            // imported to-dos arrived with a paragraph as their title and an
            // empty Notes field.
            description: input.notes || null,
            status: 'todo',
            priority: 'medium',
            assignee_ids: input.assigneeUserId ? [input.assigneeUserId] : [],
            created_by: input.createdBy,
            status_history: [{ status: 'todo', at: now, by: input.createdBy }],
        })
        .select('id')
        .single();
    if (error) throw error;
    return { id: data.id };
}
