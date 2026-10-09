import { createClient } from './client';
import { Deliverable, DeliverableType, DeliverableStatus } from '../types';
import { createNotification } from './notifications';
import { logActivity } from './client-activity';
import { validateProofUrl, validatePublishedProof } from '../search-reporting/proof';

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
        docUrl: row.doc_url ?? undefined,
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
        doc_url: d.docUrl,
        word_count: d.wordCount,
        subtype: d.subtype,
        generated_by: d.generatedBy,
        sequence_in_month: d.sequenceInMonth,
        notes: d.notes,
    };
}

async function clientDomain(supabase: NonNullable<ReturnType<typeof createClient>>, clientId: string): Promise<string | null> {
    const { data, error } = await supabase.from('clients').select('domain').eq('id', clientId).maybeSingle();
    if (error) throw error;
    return typeof data?.domain === 'string' ? data.domain : null;
}

/**
 * Moving to Published needs a live URL and a ship date. Already-published
 * rows skip this, matching the database trigger, so historical rows stay editable.
 */
async function enforcePublishedProof(
    supabase: NonNullable<ReturnType<typeof createClient>>,
    clientId: string,
    publishedUrl: string | null | undefined,
    deliveredOn: string | null | undefined,
): Promise<{ ok: true; url: string; deliveredOn: string } | { ok: false; error: string }> {
    const proof = validatePublishedProof({
        publishedUrl,
        deliveredOn,
        clientDomain: await clientDomain(supabase, clientId),
    });
    if (!proof.ok) return { ok: false, error: proof.message };
    return proof;
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
    opts: { clientId?: string; month?: string; assigneeId?: string; throwOnError?: boolean } = {},
): Promise<Deliverable[]> {
    const supabase = createClient();
    if (!supabase) {
        if (opts.throwOnError) throw new Error('Deliverables unavailable');
        return [];
    }
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
        if (opts.throwOnError) throw err;
        return [];
    }
}

/** Direct record lookup stays tenant-scoped, including dates outside the selected month. */
export async function getDeliverable(organizationId: string, id: string): Promise<Deliverable | null> {
    const supabase = createClient();
    if (!supabase) throw new Error('Deliverables unavailable');
    const { data, error } = await supabase.from('deliverables').select('*')
        .eq('organization_id', organizationId).eq('id', id).maybeSingle();
    if (error) throw new Error('Deliverable could not be loaded');
    return data ? rowToDeliverable(data) : null;
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
        if ((d.status ?? 'Pending') === 'Published') {
            const proof = await enforcePublishedProof(supabase, d.clientId, d.publishedUrl, d.completedDate);
            if (!proof.ok) return { success: false, error: proof.error };
            row.published_url = proof.url;
            row.delivered_on = proof.deliveredOn;
            row.status = 'Published';
        } else if (d.publishedUrl?.trim()) {
            const url = validateProofUrl(d.publishedUrl, await clientDomain(supabase, d.clientId));
            if (!url.ok) return { success: false, error: url.message };
            row.published_url = url.url;
        }
        const { data, error } = await supabase.from('deliverables').insert([row]).select().single();
        if (error) throw error;
        const created = rowToDeliverable(data);
        if (created.assigneeId) await notifyAssigned(d.organizationId, created, created.assigneeId);
        if (created.clientId) {
            logActivity({
                clientId: created.clientId,
                eventType: 'deliverable.created',
                metadata: { deliverableId: created.id, title: created.title, type: created.type, status: created.status },
            });
        }
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
        let prevStatus: DeliverableStatus | undefined;
        if (patch.status || patch.assigneeId || patch.publishedUrl !== undefined) {
            const { data: current, error: currentError } = await supabase
                .from('deliverables')
                .select('status, status_history, organization_id, assignee_id, published_url, delivered_on, client_id')
                .eq('id', id)
                .single();
            if (currentError || !current) return { success: false, error: 'Deliverable could not be loaded' };
            prevAssigneeId = current.assignee_id;
            // Status change: append to status_history. Publishing requires proof;
            // an already-published row can still be edited.
            if (patch.status && current.status !== patch.status) {
                prevStatus = current.status as DeliverableStatus;
                const history = Array.isArray(current.status_history) ? current.status_history : [];
                payload.status_history = [
                    ...history,
                    { status: patch.status, at: new Date().toISOString(), by: opts.actorId },
                ];
                if (patch.status === 'Published') {
                    const proof = await enforcePublishedProof(
                        supabase,
                        current.client_id,
                        patch.publishedUrl !== undefined ? patch.publishedUrl : current.published_url,
                        patch.completedDate !== undefined ? patch.completedDate : current.delivered_on,
                    );
                    if (!proof.ok) return { success: false, error: proof.error };
                    payload.published_url = proof.url;
                    payload.delivered_on = proof.deliveredOn;
                }
            } else if (patch.status && current.status === patch.status) {
                delete payload.status;
            }
            if (patch.publishedUrl?.trim() && payload.published_url === undefined) {
                const url = validateProofUrl(patch.publishedUrl, await clientDomain(supabase, current.client_id));
                if (!url.ok) return { success: false, error: url.message };
                payload.published_url = url.url;
            }
        }

        const { data, error } = await supabase.from('deliverables').update(payload).eq('id', id).select().single();
        if (error) throw error;
        const updated = rowToDeliverable(data);

        if (patch.assigneeId && patch.assigneeId !== prevAssigneeId && patch.assigneeId !== opts.actorId) {
            const orgId = opts.organizationId ?? (data as any).organization_id;
            if (orgId) await notifyAssigned(orgId, updated, patch.assigneeId);
        }

        // Log status transitions to the client activity feed. Publishing is its
        // own high-value event; other transitions log as status_changed.
        if (prevStatus && prevStatus !== updated.status && updated.clientId) {
            logActivity({
                clientId: updated.clientId,
                eventType: updated.status === 'Published' ? 'deliverable.published' : 'deliverable.status_changed',
                metadata: {
                    deliverableId: updated.id,
                    title: updated.title,
                    fromStatus: prevStatus,
                    toStatus: updated.status,
                },
            });
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
