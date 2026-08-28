import { NextRequest, NextResponse } from 'next/server';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchTimesheetCsv, isBasecampConfigured } from '@/lib/basecamp/api';
import { parseTimesheetCsv, fingerprintFor } from '@/lib/basecamp/timesheet-csv';
import { reconcileTimesheet } from '@/lib/timesheets/reconciliation';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/timesheets/reconcile?organizationId=&userId=&from=&to=
 *
 * Compares what Basecamp holds for one person over a date range against what
 * this import produced, so a reviewer can see the import is complete before
 * approving hours onto client budgets.
 *
 * Deliberately uses the CSV REPORT rather than /projects/{id}/timesheet.json:
 * that endpoint silently caps at the newest 25 entries per project and ignores
 * every paging parameter, which is exactly how two of Abel's entries were once
 * reported as deleted when they had never gone anywhere. The report filters by
 * person and date server-side and returns the full set.
 */
export async function GET(req: NextRequest) {
    const params = req.nextUrl.searchParams;
    const member = await requireOrganizationMember(params.get('organizationId'));
    if (!member.ok) return NextResponse.json({ error: member.error }, { status: member.status });

    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
        return NextResponse.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 });
    }
    if (from > to) {
        return NextResponse.json({ error: 'from must not be after to' }, { status: 400 });
    }

    // A member may only reconcile their own time; a manager may reconcile anyone's.
    const requestedUserId = params.get('userId') || member.userId;
    if (!member.isManager && requestedUserId !== member.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!isBasecampConfigured()) {
        return NextResponse.json({ error: 'Basecamp not connected', configured: false }, { status: 503 });
    }

    const admin = createAdminClient();

    // The Basecamp person is resolved from server-held membership, never from
    // the query string — otherwise anyone could read another person's timesheet
    // by naming their Basecamp id directly.
    const { data: membership, error: membershipError } = await admin
        .from('organization_members')
        .select('basecamp_person_id')
        .eq('organization_id', member.organizationId)
        .eq('user_id', requestedUserId)
        .maybeSingle();
    if (membershipError) {
        return NextResponse.json({ error: 'Unable to resolve team member' }, { status: 500 });
    }
    const personId = membership?.basecamp_person_id;
    if (!personId) {
        return NextResponse.json(
            { error: 'This person has no Basecamp account linked, so there is nothing to compare.' },
            { status: 409 },
        );
    }

    const csv = await fetchTimesheetCsv({ personId: String(personId), from, to });
    if (csv === 'unavailable') {
        return NextResponse.json({ error: 'Basecamp did not return a timesheet report' }, { status: 502 });
    }

    const providerRows = parseTimesheetCsv(csv).map(row => ({
        fingerprint: fingerprintFor(row),
        date: row.date,
        hours: row.hours,
        projectName: row.projectName,
        person: row.person,
        notes: row.notes || undefined,
    }));

    const { data: logs, error: logsError } = await admin
        .from('time_logs')
        .select('id, date, hours, description, import_fingerprint, import_status, clients(name)')
        .eq('organization_id', member.organizationId)
        .eq('user_id', requestedUserId)
        .gte('date', from)
        .lte('date', to)
        .neq('import_status', 'voided');
    if (logsError) {
        return NextResponse.json({ error: 'Unable to load local time' }, { status: 500 });
    }

    const localRows = (logs ?? []).map(log => ({
        id: log.id as string,
        fingerprint: (log.import_fingerprint as string | null) ?? null,
        date: String(log.date),
        hours: Number(log.hours),
        clientName: (log.clients as { name?: string } | null)?.name ?? null,
        description: (log.description as string | null) ?? null,
        importStatus: (log.import_status as string | null) ?? null,
    }));

    return NextResponse.json({ from, to, ...reconcileTimesheet(providerRows, localRows) });
}
