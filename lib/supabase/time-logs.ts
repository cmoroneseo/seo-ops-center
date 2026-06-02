import { createClient } from './client';
import { TimeLog } from '../types';

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
    };
}

/**
 * Time logs for an org, optionally filtered by client and/or month (YYYY-MM).
 * time_logs is the single source of truth for hours — Monthly Summary, planner
 * "logged" cells, and Department Metrics are all computed from here.
 */
export async function getTimeLogs(
    organizationId: string,
    opts: { clientId?: string; month?: string } = {},
): Promise<TimeLog[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase.from('time_logs').select('*').eq('organization_id', organizationId);
        if (opts.clientId) q = q.eq('client_id', opts.clientId);
        if (opts.month) {
            q = q.gte('date', `${opts.month}-01`).lte('date', `${opts.month}-31`);
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
