import { createClient } from './client';
import { TimeLog, TimeLogStatus, SessionNote } from '../types';

function rowToTimeLog(row: any): TimeLog {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        clientName: row.clients?.name ?? undefined,
        projectId: row.project_id ?? undefined,
        taskId: row.task_id ?? undefined,
        taskTitle: row.tasks?.title ?? undefined,
        userId: row.user_id,
        date: row.date,
        hours: Number(row.hours) || 0,
        description: row.description || '',
        billable: row.billable ?? true,
        status: (row.status as TimeLogStatus) ?? 'logged',
        timerStartedAt: row.timer_started_at ?? undefined,
        elapsedSeconds: Number(row.elapsed_seconds) || 0,
        category: row.category ?? undefined,
        sessionNotes: Array.isArray(row.session_notes) ? row.session_notes : [],
        basecampEntryId: row.basecamp_entry_id ?? undefined,
        basecampProjectId: row.basecamp_project_id ?? undefined,
        basecampSyncedAt: row.basecamp_synced_at ?? undefined,
        basecampSyncError: row.basecamp_sync_error ?? undefined,
    };
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

/** Sum of logged hours per client for a month. Powers % used / remaining. */
export async function getLoggedHoursByClient(
    organizationId: string,
    month: string,
): Promise<Record<string, number>> {
    const logs = await getTimeLogs(organizationId, { month });
    return logs.reduce<Record<string, number>>((acc, l) => {
        acc[l.clientId] = (acc[l.clientId] || 0) + l.hours;
        return acc;
    }, {});
}

export async function createTimeLog(
    log: Partial<TimeLog> & { organizationId: string; clientId: string; hours: number },
    opts: { syncToBasecamp?: boolean } = {},
): Promise<{ success: boolean; data?: TimeLog; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data, error } = await supabase
            .from('time_logs')
            .insert([{
                organization_id: log.organizationId,
                client_id: log.clientId,
                project_id: log.projectId,
                task_id: log.taskId,
                user_id: log.userId,
                date: log.date,
                hours: log.hours,
                description: log.description,
                billable: log.billable ?? true,
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
        const { data: existing } = await supabase
            .from('time_logs')
            .select('basecamp_entry_id')
            .eq('id', id)
            .maybeSingle();
        const { error } = await supabase.from('time_logs').delete().eq('id', id);
        if (error) throw error;
        if (existing?.basecamp_entry_id) {
            fetch('/api/integrations/basecamp/timesheet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove', entryId: existing.basecamp_entry_id }),
            }).catch(err => console.error('[Basecamp timesheet] remove failed:', err));
        }
        return { success: true };
    } catch (err: any) {
        console.error('Error deleting time log:', err);
        return { success: false, error: err.message };
    }
}

// ─── Timer-specific functions ────────────────────────────────────────────────

/** Create an in-progress timer entry. Returns the new row ID. */
export async function startTimer(opts: {
    organizationId: string;
    userId: string;
    clientId: string;
    taskId?: string;
    category?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const now = new Date().toISOString();
        const { data, error } = await supabase
            .from('time_logs')
            .insert([{
                organization_id: opts.organizationId,
                user_id: opts.userId,
                client_id: opts.clientId,
                task_id: opts.taskId ?? null,
                date: now.split('T')[0],
                hours: 0,
                description: '',
                billable: true,
                status: 'in_progress',
                timer_started_at: now,
                elapsed_seconds: 0,
                category: opts.category ?? null,
            }])
            .select('id')
            .single();
        if (error) throw error;
        return { success: true, id: data.id };
    } catch (err: any) {
        console.error('Error starting timer:', err);
        return { success: false, error: err.message };
    }
}

/** Pause: snapshot elapsed_seconds, clear timer_started_at. */
export async function pauseTimer(
    id: string,
    elapsedSeconds: number,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('time_logs').update({
            timer_started_at: null,
            elapsed_seconds: elapsedSeconds,
        }).eq('id', id);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** Resume: set a new timer_started_at (elapsed_seconds already saved from pause). */
export async function resumeTimer(id: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('time_logs').update({
            timer_started_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** Stop: mark as logged, write final hours + description. */
export async function stopTimer(
    id: string,
    opts: {
        hours: number;
        description: string;
        clientId: string;
        taskId?: string;
        billable: boolean;
        category?: string;
        date: string;
        syncToBasecamp?: boolean;
    },
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('time_logs').update({
            status: 'logged',
            hours: opts.hours,
            description: opts.description,
            client_id: opts.clientId,
            task_id: opts.taskId ?? null,
            billable: opts.billable,
            category: opts.category ?? null,
            date: opts.date,
            timer_started_at: null,
        }).eq('id', id);
        if (error) throw error;
        if (opts.syncToBasecamp) pushTimeLogToBasecamp(id, true);
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** Discard an in-progress timer without logging it. */
export async function discardTimer(id: string): Promise<{ success: boolean; error?: string }> {
    return deleteTimeLog(id);
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

/** Find any in-progress timer for this user. Used for session recovery. */
export async function getInProgressTimer(
    organizationId: string,
    userId: string,
): Promise<TimeLog | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('time_logs')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('user_id', userId)
            .eq('status', 'in_progress')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data ? rowToTimeLog(data) : null;
    } catch (err) {
        console.error('Error fetching in-progress timer:', err);
        return null;
    }
}
