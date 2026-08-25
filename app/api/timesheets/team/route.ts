import { createAdminClient } from '@/lib/supabase/admin';
import { createTimesheetTeamGet } from '@/lib/timesheets/team-route';
import { listLedgerLogs } from '@/lib/supabase/timesheet-ledger-source';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timesheets/team?organizationId=&weekStart=
 * Manager-only. Members and viewers get 403 before any query runs.
 */
export const GET = createTimesheetTeamGet({
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
    async listMembers(organizationId) {
        const { data, error } = await createAdminClient()
            .from('organization_members')
            .select('user_id, users(full_name, email)')
            .eq('organization_id', organizationId);
        if (error) throw error;

        return (data ?? []).map(row => {
            const user = row.users as unknown as { full_name?: string; email?: string } | null;
            return {
                userId: row.user_id,
                displayName: user?.full_name || user?.email?.split('@')[0] || 'Member',
            };
        });
    },
});
