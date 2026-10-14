import { NextResponse } from 'next/server';
import { agencyDashboardEnabled } from '@/lib/agency-dashboard/flags';
import { loadAgencyDashboard } from '@/lib/agency-dashboard/load';
import { isDashboardRange } from '@/lib/agency-dashboard/range';
import { resolveSessionOrganization } from '@/lib/reports/session-org';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const session = await resolveSessionOrganization();
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
    if (!agencyDashboardEnabled(process.env, session.organizationId)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const range = new URL(request.url).searchParams.get('range') ?? '28d';
    if (!isDashboardRange(range)) return NextResponse.json({ error: 'Choose a date range.' }, { status: 400 });
    const result = await loadAgencyDashboard(session.organizationId, range);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.dashboard);
}
