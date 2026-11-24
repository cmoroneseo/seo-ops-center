import { createAdminClient } from './admin';
import { closedTimerTime, isMissingTrimColumn, type StoredBotStretch } from '../bots/timer-trim';
import { timerRunningMs } from '../bots/timer';
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
    operation_id: string | null;
    elapsed_seconds: number | string | null;
    trimmed_from_seconds?: number | string | null;
    paused_at?: string | null;
    bot_key_id?: string | null;
    time_log_segments?: StoredBotStretch[];
    clients: { name: string } | null;
    tasks: { title: string } | null;
}

const SELECT = [
    'id', 'organization_id', 'client_id', 'task_id', 'user_id', 'date', 'hours',
    'description', 'counts_toward_budget', 'status', 'source', 'import_status',
    'voided_at', 'operation_id', 'elapsed_seconds', 'clients(name)', 'tasks(title)',
].join(', ');

function rowToLedgerLog(row: LedgerRow): LedgerLog {
    const hours = Number(row.hours);
    const paused = row.status === 'paused' && row.bot_key_id != null && row.time_log_segments
        ? closedTimerTime(Number(row.elapsed_seconds ?? 0), row.time_log_segments)
        : null;
    const originalPauseAt = row.paused_at;
    const pausedAgain = originalPauseAt != null && paused?.stretches.some(
        stretch => Date.parse(stretch.startedAt) >= Date.parse(originalPauseAt),
    );
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
        operationId: row.operation_id ?? undefined,
        elapsedSeconds: row.elapsed_seconds == null ? undefined : Number(row.elapsed_seconds),
        isBotTimer: row.bot_key_id != null,
        trimmedFromSeconds: row.trimmed_from_seconds == null ? undefined : Number(row.trimmed_from_seconds),
        ...(paused ? {
            pausedRunningSeconds: timerRunningMs(paused) / 1000,
            pausedAt: (!pausedAgain ? originalPauseAt : null) ?? paused.stretches.at(-1)?.endedAt,
        } : {}),
    };
}

export async function listLedgerLogs(
    scope: LedgerQueryScope,
    db = createAdminClient(),
): Promise<LedgerLog[]> {
    const base = `${SELECT}, bot_key_id, time_log_segments!time_log_segments_time_log_id_fkey(started_at, ended_at)`;
    function read(columns: string) {
        let query = db.from('time_logs').select(columns)
            .eq('organization_id', scope.organizationId)
            .gte('date', scope.from)
            .lte('date', scope.to);
        if (scope.userId) query = query.eq('user_id', scope.userId);
        return query.order('date', { ascending: true });
    }

    let { data, error } = await read(`${base}, trimmed_from_seconds, paused_at:paused_trim_source->>pausedAt`);
    if (isMissingTrimColumn(error)) ({ data, error } = await read(base));
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
