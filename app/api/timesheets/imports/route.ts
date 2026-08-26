import { createImportQueueGet } from '@/lib/timesheets/import-queue-route';
import { listImportQueue } from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timesheets/imports?organizationId=&userId=
 *
 * The review queue. Members see their own rows; managers see everyone's, or
 * one member when userId is supplied.
 */
export const GET = createImportQueueGet({
    async authorize(organizationId) {
        const member = await requireOrganizationMember(organizationId);
        return member.ok
            ? {
                ok: true,
                userId: member.userId,
                organizationId: member.organizationId,
                isManager: member.isManager,
            }
            : { ok: false, status: member.status, error: member.error };
    },
    listQueue: listImportQueue,
});
