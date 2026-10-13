import { NextResponse } from 'next/server';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { seoPlanV2Enabled } from '@/lib/seo-plan/flags';

export const dynamic = 'force-dynamic';

/** Shell check only. Unflagged organizations keep the current client workspace. */
export async function GET() {
    const session = await resolveSessionOrganization();
    if (!session.ok) {
        return NextResponse.json({ enabled: false });
    }
    return NextResponse.json({ enabled: seoPlanV2Enabled(process.env, session.organizationId) });
}
