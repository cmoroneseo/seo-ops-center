import { createClient } from './client';
import { Deliverable, DeliverableType, DeliverableStatus } from '../types';
import { createNotification } from './notifications';

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
        commitmentId: row.commitment_id ?? undefined,
        assigneeId: row.assignee_id ?? undefined,
        publishedUrl: row.published_url ?? undefined,
        wordCount: row.word_count ?? undefined,
        subtype: row.subtype ?? undefined,
        generatedBy: row.generated_by ?? undefined,
        sequenceInMonth: row.sequence_in_month ?? undefined,
        month: row.month ?? undefined,
        notes: row.notes ?? undefined,
        statusHistory: row.status_history ?? [],
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
        month: d.month ?? (d.dueDate ? String(d.dueDate).slice(0, 7) : undefined),
        account_manager_id: d.assignee,
        counts_toward_hours: d.countsTowardsHours,
        delivered_on: d.completedDate,
        commitment_id: d.commitmentId,
        assignee_id: d.assigneeId,
        published_url: d.publishedUrl,
        word_count: d.wordCount,
        subtype: d.subtype,
        generated_by: d.generatedBy,
        sequence_in_month: d.sequenceInMonth,
        notes: d.notes,
    };
}

/** Fire-and-forget: notify the new assignee of a deliverable. */
async function notifyAssigned(
    organizationId: string,
    deliverable: Deliverable,
    assigneeId: string,
): Promise<void> {
    await createNotification({
        organizationId,
        userId: assigneeId,
        type: 'deliverable_assigned',
        title: 'Deliverable assigned to you',
        body: deliverable.title,
        entityType: 'deliverable',
        entityId: deliverable.id,
        clientId: deliverable.clientId,
    });
}

/** Deliverables for an org, optionally filtered by client and/or month (YYYY-MM). */
export async function getDeliverables(
    organizationId: string,
    opts: { clientId?: string; month?: string; assigneeId?: string } = {},
): Promise<Deliverable[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase.from('deliverables').select('*').eq('organization_id', organizationId);
        if (opts.clientId) q = q.eq('client_id', opts.clientId);
        if (opts.month) q = q.eq('month', opts.month);
        if (opts.assigneeId) q = q.eq('assignee_id', opts.assigneeId);
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
        const row: Record<string, unknown> = {
            ...deliverableToRow(d),
            status_history: [{ status: d.status ?? 'Pending', at: new Date().toISOString() }],
        };
        const { data, error } = await supabase.from('deliverables').insert([row]).select().single();
        if (error) throw error;
        const created = rowToDeliverable(data);
        if (created.assigneeId) await notifyAssigned(d.organizationId, created, created.assigneeId);
        return { success: true, data: created };
    } catch (err: any) {
        console.error('Error creating deliverable:', err);
        return { success: false, error: err.message };
    }
}

export async function updateDeliverable(
    id: string,
    patch: Partial<Deliverable>,
    opts: { organizationId?: string; actorId?: string } = {},
): Promise<{ success: boolean; data?: Deliverable; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const row = deliverableToRow(patch);
        const payload: Record<string, unknown> = Object.fromEntries(
            Object.entries(row).filter(([, v]) => v !== undefined),
        );

        // Read current row when the change needs context (history append / assignee diff).
        let prevAssigneeId: string | null | undefined;
        if (patch.status || patch.assigneeId) {
            const { data: current } = await supabase
                .from('deliverables')
                .select('status, status_history, organization_id, assignee_id')
                .eq('id', id)
                .single();
            prevAssigneeId = current?.assignee_id;
            // Status change: append to status_history; stamp delivered_on at Published.
            if (patch.status && current && current.status !== patch.status) {
                const history = Array.isArray(current.status_history) ? current.status_history : [];
                payload.status_history = [
                    ...history,
                    { status: patch.status, at: new Date().toISOString(), by: opts.actorId },
                ];
                if (patch.status === 'Published' && !patch.completedDate) {
                    payload.delivered_on = new Date().toISOString();
                }
            } else if (patch.status && current && current.status === patch.status) {
                delete payload.status;
            }
        }

        const { data, error } = await supabase.from('deliverables').update(payload).eq('id', id).select().single();
        if (error) throw error;
        const updated = rowToDeliverable(data);

        if (patch.assigneeId && patch.assigneeId !== prevAssigneeId && patch.assigneeId !== opts.actorId) {
            const orgId = opts.organizationId ?? (data as any).organization_id;
            if (orgId) await notifyAssigned(orgId, updated, patch.assigneeId);
        }
        return { success: true, data: updated };
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
