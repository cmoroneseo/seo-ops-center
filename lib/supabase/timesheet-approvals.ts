import { createAdminClient } from './admin';
import type {
    SaveApprovalInput,
    StoredApproval,
} from '@/lib/timesheets/approval-route';
import type { ApprovalEntry } from '@/lib/timesheets/review';

/**
 * Approval persistence.
 *
 * Approvals are append-only in spirit: `saveApproval` inserts a new row with
 * its own join rows, and `reopenApproval` only flips a status and stamps who
 * did it. Nothing here ever updates a stored total — that is what makes the
 * snapshot an audit record instead of a cache.
 */

interface ApprovalRow {
    id: string;
    status: 'approved' | 'reopened';
    approved_at: string;
    approved_by: string | null;
    note: string | null;
    budget_minutes: number;
    eligible_minutes: number;
    non_budget_minutes: number;
    timesheet_approval_entries: { time_log_id: string; included_minutes: number }[] | null;
}

function rowToApproval(row: ApprovalRow): StoredApproval {
    return {
        id: row.id,
        status: row.status,
        approvedAt: row.approved_at,
        approvedBy: row.approved_by ?? undefined,
        note: row.note ?? undefined,
        budgetMinutes: row.budget_minutes,
        eligibleMinutes: row.eligible_minutes,
        nonBudgetMinutes: row.non_budget_minutes,
        entries: (row.timesheet_approval_entries ?? []).map(entry => ({
            timeLogId: entry.time_log_id,
            includedMinutes: entry.included_minutes,
        })),
    };
}

const SELECT = `
    id, status, approved_at, approved_by, note,
    budget_minutes, eligible_minutes, non_budget_minutes,
    timesheet_approval_entries(time_log_id, included_minutes)
`;

/** The live approval for a client month, or null. */
export async function getClientMonthApproval(
    organizationId: string,
    clientId: string,
    month: string,
): Promise<StoredApproval | null> {
    const { data, error } = await createAdminClient()
        .from('timesheet_client_approvals')
        .select(SELECT)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('month', month)
        .eq('status', 'approved')
        .maybeSingle();
    if (error) throw error;
    return data ? rowToApproval(data as unknown as ApprovalRow) : null;
}

export async function saveClientMonthApproval(
    input: SaveApprovalInput,
): Promise<{ id: string }> {
    const admin = createAdminClient();

    const { data, error } = await admin
        .from('timesheet_client_approvals')
        .insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            month: input.month,
            status: 'approved',
            approved_by: input.approvedBy,
            approved_at: input.approvedAt,
            note: input.note || null,
            budget_minutes: input.budgetMinutes,
            eligible_minutes: input.eligibleMinutes,
            non_budget_minutes: input.nonBudgetMinutes,
            snapshot: input.snapshot,
        })
        .select('id')
        .single();
    // The partial unique index on (client_id, month) where status='approved'
    // is the real guard against a double approval racing the read above.
    if (error) throw error;

    const entries: ApprovalEntry[] = input.entries;
    if (entries.length > 0) {
        const { error: entriesError } = await admin
            .from('timesheet_approval_entries')
            .insert(entries.map(entry => ({
                approval_id: data.id,
                time_log_id: entry.timeLogId,
                included_minutes: entry.includedMinutes,
            })));
        if (entriesError) throw entriesError;
    }

    return { id: data.id };
}

export async function reopenClientMonthApproval(input: {
    approvalId: string;
    reopenedBy: string;
    reopenedAt: string;
    note: string;
}): Promise<{ id: string }> {
    const { data, error } = await createAdminClient()
        .from('timesheet_client_approvals')
        .update({
            status: 'reopened',
            reopened_by: input.reopenedBy,
            reopened_at: input.reopenedAt,
        })
        .eq('id', input.approvalId)
        // Only a live approval can be reopened; losing a race is not an error.
        .eq('status', 'approved')
        .select('id')
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Approval was already reopened');
    return { id: data.id };
}

/** The client's contracted SEO minutes for a month, from existing client data. */
export async function getClientBudgetMinutes(clientId: string): Promise<number> {
    const { data, error } = await createAdminClient()
        .from('clients')
        .select('seo_hours')
        .eq('id', clientId)
        .maybeSingle();
    if (error) throw error;
    const hours = Number(data?.seo_hours);
    return Number.isFinite(hours) ? Math.round(hours * 60) : 0;
}
