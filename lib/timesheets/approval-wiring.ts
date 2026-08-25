import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { listClientMonthLogs } from '@/lib/supabase/timesheet-ledger-source';
import {
    getClientBudgetMinutes,
    getClientMonthApproval,
    reopenClientMonthApproval,
    saveClientMonthApproval,
} from '@/lib/supabase/timesheet-approvals';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import type {
    ApprovalRouteDependencies,
    ReviewAuthorization,
} from './approval-route';

/**
 * Shared wiring for the client-review and approval routes, so both boundaries
 * resolve authority, budget, and the ledger through exactly one path.
 */

async function authorize(
    organizationId: string,
    clientId: string,
): Promise<ReviewAuthorization> {
    const member = await requireClientOrgMember(clientId, organizationId);
    if (!member.ok) return { ok: false, status: member.status, error: member.error };

    const { data, error } = await createAdminClient()
        .from('clients')
        .select('name')
        .eq('id', member.clientId)
        .maybeSingle();
    if (error) return { ok: false, status: 500, error: 'Unable to read client' };

    return {
        ok: true,
        userId: member.userId,
        actorName: member.actorName,
        organizationId: member.organizationId,
        clientId: member.clientId,
        clientName: data?.name ?? 'Client',
        role: member.role,
        isManager: member.role === 'owner' || member.role === 'admin',
        // Budget comes from existing client data — not a second budget source.
        budgetMinutes: await getClientBudgetMinutes(member.clientId),
    };
}

export const approvalDependencies: ApprovalRouteDependencies = {
    now: () => new Date().toISOString(),
    authorize,
    listClientMonthLogs,
    getApproval: getClientMonthApproval,
    saveApproval: saveClientMonthApproval,
    reopenApproval: reopenClientMonthApproval,
    async logActivity(input) {
        await logClientActivity({
            organizationId: input.organizationId,
            clientId: input.clientId,
            eventType: input.eventType,
            actorId: input.actorId,
            actorName: input.actorName,
            metadata: input.metadata,
        });
    },
};
