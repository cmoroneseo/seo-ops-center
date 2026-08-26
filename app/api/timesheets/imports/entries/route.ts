import { createImportEntriesPatch } from '@/lib/timesheets/import-mutation-route';
import {
    applyQueueUpdate,
    loadQueueRowsByIds,
} from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/timesheets/imports/entries
 * Body: { organizationId, action: 'edit'|'submit'|'approve'|'bounce', ids, edit?, note? }
 */
export const PATCH = createImportEntriesPatch({
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
    loadRows: loadQueueRowsByIds,
    applyUpdate: applyQueueUpdate,
    now: () => new Date().toISOString(),
});
