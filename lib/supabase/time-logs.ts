import { createClient } from './client';
import { TimeLog, TimeLogStatus } from '../types';

function rowToTimeLog(row: any): TimeLog {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        projectId: row.project_id ?? undefined,
        taskId: row.task_id ?? undefined,
        userId: row.user_id,
        date: row.date,
        hours: Number(row.hours) || 0,
        description: row.description || '',
        billable: row.billable ?? true,
        status: (row.status as TimeLogStatus) ?? 'logged',
        timerStartedAt: row.timer_started_at ?? undefined,
        elapsedSeconds: Number(row.elapsed_seconds) || 0,
        category: row.category ?? undefined,
    };
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
        let q = supabase.from('time_logs').select('*').eq('organization_id', organizationId);
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
        return { success: true, data: rowToTimeLog(data) };
    } catch (err: any) {
        console.error('Error creating time log:', err);
        return { success: false, error: err.message };
    }
}

export async function updateTimeLog(
    id: string,
    patch: Partial<Pick<TimeLog, 'hours' | 'description' | 'date' | 'billable' | 'category'>>,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('time_logs').update(patch).eq('id', id);
        if (error) throw error;
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
        const { error } = await supabase.from('time_logs').delete().eq('id', id);
        if (error) throw error;
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
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/** Discard an in-progress timer without logging it. */
export async function discardTimer(id: string): Promise<{ success: boolean; error?: string }> {
    return deleteTimeLog(id);
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
