import { createClient } from './client';
import { DeliverableCommitment, DeliverableType, CommitmentCadence } from '../types';
import { EngagementModel } from '../seo-ops-logic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCommitment(row: any): DeliverableCommitment {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        type: (row.type as DeliverableType) || 'Content',
        subtype: row.subtype ?? undefined,
        title: row.title,
        quantityPerMonth: Number(row.quantity_per_month ?? 0),
        cadence: (row.cadence as CommitmentCadence) || 'monthly',
        engagementModel: (row.engagement_model as EngagementModel) || 'Retainer',
        totalQuantity: row.total_quantity ?? undefined,
        startsOn: row.starts_on,
        endsOn: row.ends_on ?? undefined,
        isActive: row.is_active ?? true,
        defaultAssigneeId: row.default_assignee_id ?? undefined,
        dueDay: row.due_day ?? undefined,
        countsTowardHours: row.counts_toward_hours ?? true,
        taskTemplateId: row.task_template_id ?? undefined,
        generateTasks: row.generate_tasks ?? false,
        notes: row.notes ?? undefined,
        customFields: row.custom_fields ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function commitmentToRow(c: Partial<DeliverableCommitment>) {
    return {
        organization_id: c.organizationId,
        client_id: c.clientId,
        type: c.type,
        subtype: c.subtype,
        title: c.title,
        quantity_per_month: c.quantityPerMonth,
        cadence: c.cadence,
        engagement_model: c.engagementModel,
        total_quantity: c.totalQuantity,
        starts_on: c.startsOn,
        ends_on: c.endsOn,
        is_active: c.isActive,
        default_assignee_id: c.defaultAssigneeId,
        due_day: c.dueDay,
        counts_toward_hours: c.countsTowardHours,
        task_template_id: c.taskTemplateId,
        generate_tasks: c.generateTasks,
        notes: c.notes,
        custom_fields: c.customFields,
    };
}

/**
 * Keep clients.blogs_due_per_month in step with the client's active blog
 * commitments so onTrackStatus() and the legacy change-log trigger keep
 * working until Phase 2 retires those fields.
 */
async function syncClientBlogCadence(clientId: string): Promise<void> {
    const supabase = createClient();
    if (!supabase) return;
    try {
        const { data, error } = await supabase
            .from('deliverable_commitments')
            .select('quantity_per_month, subtype, type, is_active, engagement_model')
            .eq('client_id', clientId)
            .eq('is_active', true)
            .eq('type', 'Content')
            .eq('subtype', 'blog')
            .eq('engagement_model', 'Retainer');
        if (error) throw error;
        const total = (data ?? []).reduce((sum: number, r: any) => sum + Number(r.quantity_per_month ?? 0), 0);
        await supabase.from('clients').update({ blogs_due_per_month: total }).eq('id', clientId);
    } catch (err) {
        console.error('Error syncing client blog cadence:', err);
    }
}

/** Commitments for an org, optionally filtered by client. Active first. */
export async function getCommitments(
    organizationId: string,
    opts: { clientId?: string; activeOnly?: boolean } = {},
): Promise<DeliverableCommitment[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase.from('deliverable_commitments').select('*').eq('organization_id', organizationId);
        if (opts.clientId) q = q.eq('client_id', opts.clientId);
        if (opts.activeOnly) q = q.eq('is_active', true);
        const { data, error } = await q
            .order('is_active', { ascending: false })
            .order('created_at', { ascending: true });
        if (error) throw error;
        return (data || []).map(rowToCommitment);
    } catch (err) {
        console.error('Error fetching commitments:', err);
        return [];
    }
}

export async function createCommitment(
    c: Partial<DeliverableCommitment> & { organizationId: string; clientId: string; title: string; startsOn: string },
): Promise<{ success: boolean; data?: DeliverableCommitment; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data, error } = await supabase
            .from('deliverable_commitments')
            .insert([commitmentToRow(c)])
            .select()
            .single();
        if (error) throw error;
        await syncClientBlogCadence(c.clientId);
        return { success: true, data: rowToCommitment(data) };
    } catch (err: any) {
        console.error('Error creating commitment:', err);
        return { success: false, error: err.message };
    }
}

export async function updateCommitment(
    id: string,
    patch: Partial<DeliverableCommitment>,
): Promise<{ success: boolean; data?: DeliverableCommitment; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const row = commitmentToRow(patch);
        const payload = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
        payload.updated_at = new Date().toISOString();
        const { data, error } = await supabase
            .from('deliverable_commitments')
            .update(payload)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        const updated = rowToCommitment(data);
        await syncClientBlogCadence(updated.clientId);
        return { success: true, data: updated };
    } catch (err: any) {
        console.error('Error updating commitment:', err);
        return { success: false, error: err.message };
    }
}

/** End a commitment (sets is_active=false + ends_on) — never hard-deletes history. */
export async function endCommitment(
    id: string,
    endsOn: string = new Date().toISOString().slice(0, 10),
): Promise<{ success: boolean; error?: string }> {
    const res = await updateCommitment(id, { isActive: false, endsOn });
    return { success: res.success, error: res.error };
}

export async function deleteCommitment(id: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data, error } = await supabase
            .from('deliverable_commitments')
            .delete()
            .eq('id', id)
            .select('client_id')
            .single();
        if (error) throw error;
        if (data?.client_id) await syncClientBlogCadence(data.client_id);
        return { success: true };
    } catch (err: any) {
        console.error('Error deleting commitment:', err);
        return { success: false, error: err.message };
    }
}
