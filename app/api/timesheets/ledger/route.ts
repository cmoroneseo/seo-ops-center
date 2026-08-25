import { createTimesheetLedgerGet } from '@/lib/timesheets/ledger-route';
import { listLedgerLogs } from '@/lib/supabase/timesheet-ledger-source';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timesheets/ledger?organizationId=&weekStart=&userId=&scope=
 *
 * The weekly Ledger Grid read model. Members read their own week; managers may
 * read a named member or the whole team.
 */
export const GET = createTimesheetLedgerGet({
    now: () => new Date().toISOString(),
    async authorize(organizationId) {
        const member = await requireOrganizationMember(organizationId);
        return member.ok
            ? {
                ok: true,
                userId: member.userId,
                organizationId: member.organizationId,
                role: member.role,
                isManager: member.isManager,
            }
            : { ok: false, status: member.status, error: member.error };
    },
    listLogs: listLedgerLogs,
});
