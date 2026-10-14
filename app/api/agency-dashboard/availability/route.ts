import { NextResponse } from 'next/server';
import { agencyDashboardEnabled } from '@/lib/agency-dashboard/flags';
import { resolveSessionOrganization } from '@/lib/reports/session-org';

export const dynamic = 'force-dynamic';

/** Shell check only. The data route stays 404 while the flag is off. */
export async function GET() {
    const session = await resolveSessionOrganization();
    if (!session.ok) return NextResponse.json({ enabled: false });
    return NextResponse.json({ enabled: agencyDashboardEnabled(process.env, session.organizationId) });
}
