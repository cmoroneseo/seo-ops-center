import { createClient } from './client';
import { Reminder, ReminderRecurrence } from '../types';
import { nextDueDate } from '../reminders-logic';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToReminder(row: any): Reminder {
    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        title: row.title,
        notes: row.notes ?? undefined,
        dueAt: row.due_at,
        notifyOffsetMinutes: row.notify_offset_minutes ?? undefined,
        recurrence: row.recurrence,
        clientId: row.client_id ?? undefined,
        status: row.status,
        notifiedAt: row.notified_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listReminders(params: {
    organizationId: string;
    userId: string;
}): Promise<Reminder[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const base = supabase
            .from('personal_reminders')
            .select('*')
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId);
        const [pending, done] = await Promise.all([
            base.eq('status', 'pending').order('due_at', { ascending: true }),
            supabase
                .from('personal_reminders')
                .select('*')
                .eq('organization_id', params.organizationId)
                .eq('user_id', params.userId)
                .neq('status', 'pending')
                .order('completed_at', { ascending: false })
                .limit(20),
        ]);
        if (pending.error) throw pending.error;
        if (done.error) throw done.error;
        return [...(pending.data ?? []), ...(done.data ?? [])].map(rowToReminder);
    } catch (err) {
        console.error('[personal-reminders] list error:', err);
        return [];
    }
}

export async function createReminder(params: {
    organizationId: string;
    userId: string;
    title: string;
    dueAt: string;
    notifyOffsetMinutes?: number | null;
    recurrence?: ReminderRecurrence;
    clientId?: string | null;
    notes?: string;
}): Promise<Reminder | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('personal_reminders')
            .insert([{
                organization_id: params.organizationId,
                user_id: params.userId,
                title: params.title,
                notes: params.notes ?? null,
                due_at: params.dueAt,
                notify_offset_minutes: params.notifyOffsetMinutes === undefined ? 0 : params.notifyOffsetMinutes,
                recurrence: params.recurrence ?? 'none',
                client_id: params.clientId ?? null,
            }])
            .select('*')
            .single();
        if (error) throw error;
        return rowToReminder(data);
    } catch (err) {
        console.error('[personal-reminders] create error:', err);
        return null;
    }
}

export async function updateReminder(
    id: string,
    patch: {
        title?: string;
        notes?: string | null;
        dueAt?: string;
        notifyOffsetMinutes?: number | null;
        recurrence?: ReminderRecurrence;
        clientId?: string | null;
    },
): Promise<Reminder | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.title !== undefined) row.title = patch.title;
        if (patch.notes !== undefined) row.notes = patch.notes;
        if (patch.dueAt !== undefined) {
            row.due_at = patch.dueAt;
            row.notified_at = null; // date changed → allow it to fire again
        }
        if (patch.notifyOffsetMinutes !== undefined) row.notify_offset_minutes = patch.notifyOffsetMinutes;
        if (patch.recurrence !== undefined) row.recurrence = patch.recurrence;
        if (patch.clientId !== undefined) row.client_id = patch.clientId;
        const { data, error } = await supabase
            .from('personal_reminders')
            .update(row)
            .eq('id', id)
            .select('*')
            .single();
        if (error) throw error;
        return rowToReminder(data);
    } catch (err) {
        console.error('[personal-reminders] update error:', err);
        return null;
    }
}

/**
 * Complete a reminder. Recurring reminders advance to the next occurrence
 * (still pending, eligible to notify again); one-time reminders become done.
 */
export async function completeReminder(reminder: Reminder): Promise<Reminder | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        // Advance past the current time, not just one period past the old
        // due date — otherwise completing a reminder that's been overdue
        // for several periods leaves it still overdue, and the cron
        // immediately re-fires a fresh notification on the next tick.
        let next = nextDueDate(reminder.dueAt, reminder.recurrence);
        while (next && new Date(next).getTime() <= Date.now()) {
            next = nextDueDate(next, reminder.recurrence);
        }
        const row: Record<string, unknown> = next
            ? { due_at: next, notified_at: null, updated_at: new Date().toISOString() }
            : { status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        const { data, error } = await supabase
            .from('personal_reminders')
            .update(row)
            .eq('id', reminder.id)
            .select('*')
            .single();
        if (error) throw error;
        return rowToReminder(data);
    } catch (err) {
        console.error('[personal-reminders] complete error:', err);
        return null;
    }
}

export async function snoozeReminder(id: string, newDueAtIso: string): Promise<Reminder | null> {
    return updateReminder(id, { dueAt: newDueAtIso });
}

export async function deleteReminder(id: string): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('personal_reminders').delete().eq('id', id);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[personal-reminders] delete error:', err);
        return false;
    }
}

export async function countOverdueReminders(params: {
    organizationId: string;
    userId: string;
}): Promise<number> {
    const supabase = createClient();
    if (!supabase) return 0;
    try {
        const { count, error } = await supabase
            .from('personal_reminders')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .eq('status', 'pending')
            .lt('due_at', new Date().toISOString());
        if (error) throw error;
        return count ?? 0;
    } catch (err) {
        console.error('[personal-reminders] overdue count error:', err);
        return 0;
    }
}
