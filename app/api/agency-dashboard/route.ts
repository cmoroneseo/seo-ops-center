import { NextResponse } from 'next/server';
import { agencyDashboardEnabled } from '@/lib/agency-dashboard/flags';
import { loadAgencyDashboard } from '@/lib/agency-dashboard/load';
import { isDashboardRange } from '@/lib/agency-dashboard/range';
import { teamMatchesSession } from '@/lib/agency-dashboard/request';
import { resolveSessionOrganization } from '@/lib/reports/session-org';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
    const session = await resolveSessionOrganization();
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status, headers: NO_STORE });
    if (!agencyDashboardEnabled(process.env, session.organizationId)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    }
    const url = new URL(request.url);
    if (!teamMatchesSession(url.searchParams.get('team'), session.organizationId)) {
        return NextResponse.json({ error: 'Organization changed.' }, { status: 409, headers: NO_STORE });
    }
    const range = url.searchParams.get('range') ?? '28d';
    if (!isDashboardRange(range)) return NextResponse.json({ error: 'Choose a date range.' }, { status: 400, headers: NO_STORE });
    const result = await loadAgencyDashboard(session.organizationId, range);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
    return NextResponse.json(result.dashboard, { headers: NO_STORE });
}
