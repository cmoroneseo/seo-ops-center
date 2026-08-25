import { createAdminClient } from './admin';
import type { LedgerLog } from '@/lib/timesheets/ledger';
import type { LedgerQueryScope } from '@/lib/timesheets/ledger-route';
import type { TimeLogImportStatus, TimeLogSource, TimeLogStatus } from '@/lib/types';

/**
 * Server-side ledger reads.
 *
 * Uses the service role deliberately: the route above it has already decided
 * *whose* time the caller may see, and member-level privacy is not something
 * the org-scoped RLS policy can express. Nothing here reads a browser-supplied
 * organization or user id — both arrive already verified.
 */

interface LedgerRow {
    id: string;
    organization_id: string;
    client_id: string | null;
    task_id: string | null;
    user_id: string | null;
    date: string;
    hours: number | string;
    description: string | null;
    counts_toward_budget: boolean | null;
    status: string;
    source: string | null;
    import_status: string | null;
    voided_at: string | null;
    clients: { name: string } | null;
    tasks: { title: string } | null;
}

const SELECT = [
    'id', 'organization_id', 'client_id', 'task_id', 'user_id', 'date', 'hours',
    'description', 'counts_toward_budget', 'status', 'source', 'import_status',
    'voided_at', 'clients(name)', 'tasks(title)',
].join(', ');

function rowToLedgerLog(row: LedgerRow): LedgerLog {
    const hours = Number(row.hours);
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id ?? undefined,
        clientName: row.clients?.name ?? undefined,
        taskId: row.task_id ?? undefined,
        taskTitle: row.tasks?.title ?? undefined,
        // An unmapped import can have no member yet; the grid buckets it for review.
        userId: row.user_id ?? '',
        date: row.date,
        hours: Number.isFinite(hours) ? hours : 0,
        description: row.description ?? '',
        countsTowardBudget: row.counts_toward_budget !== false,
        status: (row.status as TimeLogStatus) ?? 'logged',
        source: (row.source as TimeLogSource) ?? 'seo_pm',
        importStatus: (row.import_status as TimeLogImportStatus) ?? 'mapped',
        voidedAt: row.voided_at ?? undefined,
    };
}

export async function listLedgerLogs(scope: LedgerQueryScope): Promise<LedgerLog[]> {
    let query = createAdminClient()
        .from('time_logs')
        .select(SELECT)
        .eq('organization_id', scope.organizationId)
        .gte('date', scope.from)
        .lte('date', scope.to);

    if (scope.userId) {
        // Unmapped imports have no member yet, so a manager viewing one
        // person still needs them; a member-scoped read never does.
        query = query.eq('user_id', scope.userId);
    }

    const { data, error } = await query.order('date', { ascending: true });
    if (error) throw error;
    return (data as unknown as LedgerRow[] ?? []).map(rowToLedgerLog);
}

/** Every ledger row for one client month, for the approval read model. */
export async function listClientMonthLogs(
    organizationId: string,
    clientId: string,
    month: string,
): Promise<LedgerLog[]> {
    const [year, monthIndex] = month.split('-').map(Number);
    const lastDay = new Date(year, monthIndex, 0).getDate();

    const { data, error } = await createAdminClient()
        .from('time_logs')
        .select(SELECT)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .gte('date', `${month}-01`)
        .lte('date', `${month}-${String(lastDay).padStart(2, '0')}`)
        .order('date', { ascending: true });
    if (error) throw error;
    return (data as unknown as LedgerRow[] ?? []).map(rowToLedgerLog);
}
