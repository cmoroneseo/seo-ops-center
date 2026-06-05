import { createClient } from './client';

export interface ClientChangeLogEntry {
    id: string;
    clientId: string;
    dateOfChange: string;
    changedById?: string;
    prevSeoHours?: number;
    newSeoHours?: number;
    prevBlogCount?: number;
    newBlogCount?: number;
    effectiveDate?: string;
    notes?: string;
}

function rowToEntry(row: any): ClientChangeLogEntry {
    return {
        id: row.id,
        clientId: row.client_id,
        dateOfChange: row.date_of_change,
        changedById: row.changed_by_id ?? undefined,
        prevSeoHours: row.prev_seo_hours ?? undefined,
        newSeoHours: row.new_seo_hours ?? undefined,
        prevBlogCount: row.prev_blog_count ?? undefined,
        newBlogCount: row.new_blog_count ?? undefined,
        effectiveDate: row.effective_date ?? undefined,
        notes: row.notes ?? undefined,
    };
}

/**
 * Returns the seo_hours that were in effect for a client during a given month
 * (YYYY-MM). Walks back through the change log: if there's a change whose
 * effective_date falls after the last day of that month, the *previous* value
 * was active then. Falls back to currentHours if no changes predate the month.
 */
export async function getSeoHoursForMonth(
    organizationId: string,
    clientId: string,
    month: string,
    currentHours: number,
): Promise<number> {
    const entries = await getClientChangeLog(organizationId, clientId);
    if (!entries.length) return currentHours;

    // Last day of the requested month (inclusive)
    const [y, m] = month.split('-').map(Number);
    const monthEnd = new Date(y, m, 0); // day 0 of next month = last day of this month

    // Sort ascending by effective_date
    const sorted = [...entries]
        .filter(e => e.effectiveDate)
        .sort((a, b) => a.effectiveDate!.localeCompare(b.effectiveDate!));

    // Walk forward: find the last change whose effective_date is <= monthEnd
    // The hours in effect for that month = newSeoHours of that change (or
    // prevSeoHours of the first change that comes AFTER monthEnd).
    let hoursAtMonthEnd = currentHours;
    for (const entry of sorted) {
        const eDate = new Date(entry.effectiveDate!);
        if (eDate <= monthEnd) {
            hoursAtMonthEnd = entry.newSeoHours ?? hoursAtMonthEnd;
        }
    }
    return hoursAtMonthEnd;
}

/**
 * Client change history. New entries are written automatically by a DB trigger
 * when seo_hours / blogs_due_per_month change — this is read-only in practice.
 */
export async function getClientChangeLog(
    organizationId: string,
    clientId?: string,
): Promise<ClientChangeLogEntry[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase.from('client_change_log').select('*').eq('organization_id', organizationId);
        if (clientId) q = q.eq('client_id', clientId);
        const { data, error } = await q.order('date_of_change', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToEntry);
    } catch (err) {
        console.error('Error fetching client change log:', err);
        return [];
    }
}
