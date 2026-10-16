import { NextResponse } from 'next/server';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { seoPlanStageListEnabled } from '@/lib/seo-plan/flags';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** Shell check only. The organization comes from the session, not the query. */
export async function GET() {
    const session = await resolveSessionOrganization();
    if (!session.ok) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
    return NextResponse.json(
        { enabled: seoPlanStageListEnabled(process.env, session.organizationId) },
        { headers: NO_STORE },
    );
}
