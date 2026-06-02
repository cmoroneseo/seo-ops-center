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
