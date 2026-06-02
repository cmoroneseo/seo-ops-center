import { createClient } from './client';
import { Deliverable, DeliverableType, DeliverableStatus } from '../types';

function rowToDeliverable(row: any): Deliverable {
    return {
        id: row.id,
        clientId: row.client_id,
        title: row.title,
        type: (row.type as DeliverableType) || 'Content',
        status: (row.status as DeliverableStatus) || 'Pending',
        dueDate: row.due_date,
        completedDate: row.delivered_on ?? undefined,
        countsTowardsHours: row.counts_toward_hours ?? true,
        assignee: row.account_manager_id ?? undefined,
        link: row.custom_fields?.link ?? undefined,
    };
}

function deliverableToRow(d: Partial<Deliverable> & { organizationId?: string }) {
    return {
        organization_id: d.organizationId,
        client_id: d.clientId,
        title: d.title,
        type: d.type,
        status: d.status,
        due_date: d.dueDate,
        month: d.dueDate ? String(d.dueDate).slice(0, 7) : undefined,
        account_manager_id: d.assignee,
        counts_toward_hours: d.countsTowardsHours,
        delivered_on: d.completedDate,
    };
}

/** Deliverables for an org, optionally filtered by client and/or month (YYYY-MM). */
export async function getDeliverables(
    organizationId: string,
    opts: { clientId?: string; month?: string } = {},
): Promise<Deliverable[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase.from('deliverables').select('*').eq('organization_id', organizationId);
        if (opts.clientId) q = q.eq('client_id', opts.clientId);
        if (opts.month) q = q.eq('month', opts.month);
        const { data, error } = await q.order('due_date', { ascending: true });
        if (error) throw error;
        return (data || []).map(rowToDeliverable);
    } catch (err) {
        console.error('Error fetching deliverables:', err);
        return [];
    }
}

export async function createDeliverable(
    d: Partial<Deliverable> & { organizationId: string; clientId: string },
): Promise<{ success: boolean; data?: Deliverable; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data, error } = await supabase.from('deliverables').insert([deliverableToRow(d)]).select().single();
        if (error) throw error;
        return { success: true, data: rowToDeliverable(data) };
    } catch (err: any) {
        console.error('Error creating deliverable:', err);
        return { success: false, error: err.message };
    }
}

export async function updateDeliverable(
    id: string,
    patch: Partial<Deliverable>,
): Promise<{ success: boolean; data?: Deliverable; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const row = deliverableToRow(patch);
        const payload = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
        const { data, error } = await supabase.from('deliverables').update(payload).eq('id', id).select().single();
        if (error) throw error;
        return { success: true, data: rowToDeliverable(data) };
    } catch (err: any) {
        console.error('Error updating deliverable:', err);
        return { success: false, error: err.message };
    }
}

export async function deleteDeliverable(id: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('deliverables').delete().eq('id', id);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error deleting deliverable:', err);
        return { success: false, error: err.message };
    }
}
