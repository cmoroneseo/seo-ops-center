import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchTimesheetCsv } from '@/lib/basecamp/api';
import { createCsvBackfill } from '@/lib/timesheets/backfill';
import { createTimesheetImportStore } from '@/lib/basecamp/timesheet-import-store';
import {
    finishImportRun,
    listProjectRoles,
    startImportRun,
} from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const store = createTimesheetImportStore();

/**
 * POST /api/timesheets/import/backfill
 * Body: { organizationId, userId, from, to }
 *
 * Manager-only historical import from Basecamp's timesheet CSV report.
 * Idempotent: identity is the row fingerprint, so re-running never duplicates.
 */
export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const input = (body ?? {}) as Record<string, unknown>;
    const organizationId = typeof input.organizationId === 'string' ? input.organizationId : '';

    const backfill = createCsvBackfill({
        now: () => new Date().toISOString(),

        async authorize(userId) {
            const member = await requireOrganizationMember(organizationId);
            if (!member.ok) return { ok: false, status: member.status, error: member.error };
            if (!member.isManager) return { ok: false, status: 403, error: 'Forbidden' };

            const { data, error } = await createAdminClient()
                .from('organization_members')
                .select('basecamp_person_id')
                .eq('organization_id', member.organizationId)
                .eq('user_id', userId)
                .maybeSingle();
            if (error) return { ok: false, status: 500, error: 'Unable to read member' };
            if (!data?.basecamp_person_id) {
                return { ok: false, status: 400, error: 'That member has no Basecamp person linked' };
            }

            return {
                ok: true,
                organizationId: member.organizationId,
                actorUserId: member.userId,
                targetUserId: userId,
                basecampPersonId: String(data.basecamp_person_id),
            };
        },

        listProjectRoles,
        fetchCsv: fetchTimesheetCsv,
        startRun: startImportRun,
        finishRun: finishImportRun,
        upsertImportedEntry: store.upsertImportedEntry,
    });

    const outcome = await backfill({
        userId: typeof input.userId === 'string' ? input.userId : '',
        from: typeof input.from === 'string' ? input.from : '',
        to: typeof input.to === 'string' ? input.to : '',
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
}
