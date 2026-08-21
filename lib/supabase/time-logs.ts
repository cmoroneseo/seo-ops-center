import { createClient } from './client';
import { TimeLog, SessionNote, TimerAttempt } from '../types';
import {
    sumBudgetHoursByClient,
    sumTrackedHoursByClient,
    sumInternalHours,
} from '../time-budget-logic';
import { deleteTimeLogAcrossSystems } from '../time-log-deletion';
import {
    timerAttemptFromRow,
    timerStateFromRows,
    type TimerMutationRequest,
    type TimerStateResponse,
} from '../timer/contracts';

function rowToTimeLog(row: any): TimeLog {
    return timerAttemptFromRow(row);
}

// ---------------------------------------------------------------------------
// Basecamp timesheet sync (fire-and-forget, mirrors the task push in tasks.ts)
// ---------------------------------------------------------------------------

/**
 * Push a time log to the client's Basecamp project timesheet.
 * Server-side no-op unless the client has timesheet sync enabled;
 * only creates a new Basecamp entry when createIfMissing is true.
 */
export function pushTimeLogToBasecamp(timeLogId: string, createIfMissing = false): void {
    fetch('/api/integrations/basecamp/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', timeLogId, createIfMissing }),
    }).catch(err => console.error('[Basecamp timesheet] push failed:', err));
}

/** True when this client's time entries should offer "Send to Basecamp". */
export async function getClientTimesheetSyncEnabled(clientId: string | undefined): Promise<boolean> {
    if (!clientId) return false;
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const { data } = await supabase
            .from('clients')
            .select('custom_fields')
            .eq('id', clientId)
            .single();
        const cf = (data?.custom_fields as Record<string, unknown>) ?? {};
        return !!(cf.basecamp_sync_enabled && cf.basecamp_project_id && cf.basecamp_timesheet_enabled);
    } catch {
        return false;
    }
}

/**
 * Time logs for an org, optionally filtered by client and/or month (YYYY-MM).
 * Excludes in_progress entries by default — pass includeInProgress to include them.
 */
export async function getTimeLogs(
    organizationId: string,
    opts: { clientId?: string; month?: string; includeInProgress?: boolean } = {},
): Promise<TimeLog[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase.from('time_logs').select('*, clients(name), tasks(title)').eq('organization_id', organizationId);
        if (!opts.includeInProgress) q = q.eq('status', 'logged');
        if (opts.clientId) q = q.eq('client_id', opts.clientId);
        if (opts.month) {
            const [y, m] = opts.month.split('-').map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            q = q.gte('date', `${opts.month}-01`).lte('date', `${opts.month}-${String(lastDay).padStart(2, '0')}`);
        }
        const { data, error } = await q.order('date', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToTimeLog);
    } catch (err) {
        console.error('Error fetching time logs:', err);
        return [];
    }
}

function localDateKey(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Segment-backed attempts that can produce actual-time cards in a visible
 * planner range. Open attempts are included regardless of their original date
 * so a session that crosses midnight remains visible until it is finalized.
 */
export async function getTimerAttemptsForRange(
    organizationId: string,
    rangeStart: Date,
    rangeEnd: Date,
): Promise<TimerAttempt[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const selection = '*, clients(name), tasks(title), time_log_segments(*)';
        const lastVisibleInstant = new Date(rangeEnd.getTime() - 1);
        const [logged, open] = await Promise.all([
            supabase
                .from('time_logs')
                .select(selection)
                .eq('organization_id', organizationId)
                .eq('status', 'logged')
                .gte('date', localDateKey(rangeStart))
                .lte('date', localDateKey(lastVisibleInstant)),
            supabase
                .from('time_logs')
                .select(selection)
                .eq('organization_id', organizationId)
                .eq('status', 'in_progress'),
        ]);
        if (logged.error) throw logged.error;
        if (open.error) throw open.error;

        const rows = [...(logged.data ?? []), ...(open.data ?? [])];
        return rows.map(timerAttemptFromRow);
    } catch (error) {
        console.error('Error fetching timer attempts for planner:', error);
        return [];
    }
}

/**
 * Hours consumed against each client's SEO budget for a month.
 *
 * Deliberately excludes internal work (no client) and anything flagged
 * `countsTowardBudget: false` — a client meeting is tracked and may be billable,
 * but it must not eat deliverable hours. Use getTrackedHoursByClient when you
 * want everything regardless of budget treatment.
 */
export async function getLoggedHoursByClient(
    organizationId: string,
    month: string,
): Promise<Record<string, number>> {
    return sumBudgetHoursByClient(await getTimeLogs(organizationId, { month }));
}

/** Every tracked hour against a client, budget-consuming or not. */
export async function getTrackedHoursByClient(
    organizationId: string,
    month: string,
): Promise<Record<string, number>> {
    return sumTrackedHoursByClient(await getTimeLogs(organizationId, { month }));
}

/** Hours with no client attached — internal meetings, admin, and the like. */
export async function getInternalHours(
    organizationId: string,
    month: string,
): Promise<number> {
    return sumInternalHours(await getTimeLogs(organizationId, { month }));
}

export async function createTimeLog(
    // clientId is no longer required: internal work has no client (migration 030).
    log: Partial<TimeLog> & { organizationId: string; hours: number },
    // Basecamp push is independent of counts_toward_budget: a client meeting is
    // excluded from SEO budget but still belongs on their Basecamp timesheet.
    opts: { syncToBasecamp?: boolean } = {},
): Promise<{ success: boolean; data?: TimeLog; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data, error } = await supabase
            .from('time_logs')
            .insert([{
                organization_id: log.organizationId,
                client_id: log.clientId ?? null,
                project_id: log.projectId,
                task_id: log.taskId,
                planner_event_id: log.plannerEventId ?? null,
                // Destination for internal time; client logs resolve theirs
                // from the client's config at sync time.
                basecamp_project_id: log.basecampProjectId ?? null,
                user_id: log.userId,
                date: log.date,
                hours: log.hours,
                description: log.description,
                billable: log.billable ?? true,
                counts_toward_budget: log.countsTowardBudget ?? true,
                status: 'logged',
                category: log.category,
            }])
            .select()
            .single();
        if (error) throw error;
        if (opts.syncToBasecamp) pushTimeLogToBasecamp(data.id, true);
        return { success: true, data: rowToTimeLog(data) };
    } catch (err: any) {
        console.error('Error creating time log:', err);
        return { success: false, error: err.message };
    }
}

/** Has this planner block already been logged? Keeps the action idempotent. */
export async function getTimeLogForPlannerEvent(eventId: string): Promise<TimeLog | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('time_logs')
            .select('*, clients(name), tasks(title)')
            .eq('planner_event_id', eventId)
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data ? rowToTimeLog(data) : null;
    } catch (err) {
        console.error('[time-logs] planner event lookup error:', err);
        return null;
    }
}

export async function updateTimeLog(
    id: string,
    patch: Partial<Pick<TimeLog, 'hours' | 'description' | 'date' | 'billable' | 'category' | 'sessionNotes'>>,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        // Map camelCase sessionNotes → snake_case session_notes for Supabase
        const { sessionNotes, ...rest } = patch;
        const dbPatch: Record<string, unknown> = { ...rest };
        if (sessionNotes !== undefined) dbPatch.session_notes = sessionNotes;
        const { error } = await supabase.from('time_logs').update(dbPatch).eq('id', id);
        if (error) throw error;
        // Keep an already-synced Basecamp entry in step (no-op otherwise)
        pushTimeLogToBasecamp(id, false);
        return { success: true };
    } catch (err: any) {
        console.error('Error updating time log:', err);
        return { success: false, error: err.message };
    }
}

export async function deleteTimeLog(id: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        // Grab the Basecamp entry ID before the row disappears
        const { data: existing, error: lookupError } = await supabase
            .from('time_logs')
            .select('basecamp_entry_id')
            .eq('id', id)
            .maybeSingle();
        if (lookupError) throw lookupError;

        return await deleteTimeLogAcrossSystems({
            basecampEntryId: existing?.basecamp_entry_id,
            removeBasecampEntry: () => fetch('/api/integrations/basecamp/timesheet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'remove',
                    entryId: existing?.basecamp_entry_id,
                    timeLogId: id,
                }),
            }),
            removeLocalEntry: async () => {
                const { error } = await supabase.from('time_logs').delete().eq('id', id);
                if (error) throw error;
            },
        });
    } catch (err: any) {
        console.error('Error deleting time log:', err);
        return { success: false, error: err.message };
    }
}

// ─── Timer-specific functions ────────────────────────────────────────────────

const emptyTimerState = (): TimerStateResponse => ({ running: null, paused: [] });

/** Browser timer mutations contain intent only; authority is derived by the API. */
export async function mutateTimer(request: TimerMutationRequest): Promise<TimerStateResponse> {
    const response = await fetch('/api/time-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    const payload = await response.json().catch(() => ({})) as TimerStateResponse & { error?: string };
    if (!response.ok) throw new Error(payload.error || 'Unable to update timer');
    return payload;
}

/** Recover every open attempt owned by the authenticated user in this org. */
export async function getOpenTimerAttempts(organizationId: string): Promise<TimerStateResponse> {
    const supabase = createClient();
    if (!supabase) return emptyTimerState();
    try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) return emptyTimerState();

        const { data, error } = await supabase
            .from('time_logs')
            .select('*, clients(name), tasks(title), time_log_segments(*)')
            .eq('organization_id', organizationId)
            .eq('user_id', user.id)
            .eq('status', 'in_progress')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return timerStateFromRows(data ?? []);
    } catch (error) {
        console.error('Error fetching open timer attempts:', error);
        return emptyTimerState();
    }
}

/** @deprecated Use mutateTimer({ action: 'start', taskId }) instead. */
export async function startTimer(opts: {
    organizationId: string;
    userId: string;
    /** Omitted for internal work — an internal 1:1 has no client. */
    clientId?: string;
    taskId?: string;
    plannerEventId?: string;
    countsTowardBudget?: boolean;
    category?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
    if (!opts.taskId) return { success: false, error: 'A task is required to start a timer' };
    try {
        const state = await mutateTimer({ action: 'start', taskId: opts.taskId });
        return state.running
            ? { success: true, id: state.running.id }
            : { success: false, error: 'Timer did not start' };
    } catch (err: any) {
        console.error('Error starting timer:', err);
        return { success: false, error: err.message };
    }
}

/** @deprecated Use mutateTimer({ action: 'pause', timeLogId }) instead. */
export async function pauseTimer(
    id: string,
    elapsedSeconds: number,
): Promise<{ success: boolean; error?: string }> {
    void elapsedSeconds;
    try {
        await mutateTimer({ action: 'pause', timeLogId: id });
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** @deprecated Use mutateTimer({ action: 'resume', timeLogId }) instead. */
export async function resumeTimer(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        await mutateTimer({ action: 'resume', timeLogId: id });
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** @deprecated Use begin_stop followed by finalize through mutateTimer. */
export async function stopTimer(
    id: string,
    opts: {
        hours: number;
        description: string;
        clientId?: string;
        taskId?: string;
        billable: boolean;
        countsTowardBudget?: boolean;
        category?: string;
        date: string;
        syncToBasecamp?: boolean;
    },
): Promise<{ success: boolean; error?: string }> {
    try {
        await mutateTimer({ action: 'begin_stop', timeLogId: id });
        await mutateTimer({
            action: 'finalize',
            timeLogId: id,
            description: opts.description,
            billable: opts.billable,
            countsTowardBudget: opts.countsTowardBudget ?? true,
            syncToBasecamp: opts.syncToBasecamp ?? false,
            markTaskComplete: false,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        });
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** Discard an in-progress timer without logging it. */
export async function discardTimer(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        await mutateTimer({ action: 'discard', timeLogId: id });
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** Persist the full session_notes array for an in-progress entry. */
export async function updateSessionNotes(
    id: string,
    notes: SessionNote[],
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase
            .from('time_logs')
            .update({ session_notes: notes })
            .eq('id', id);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** @deprecated Use getOpenTimerAttempts to preserve all paused attempts. */
export async function getInProgressTimer(
    organizationId: string,
    userId: string,
): Promise<TimeLog | null> {
    void userId;
    const state = await getOpenTimerAttempts(organizationId);
    return state.running ?? state.paused[0] ?? null;
}
