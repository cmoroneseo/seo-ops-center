import { NextRequest, NextResponse } from 'next/server';
import { recordPlanDecision } from '@/lib/portal/actions';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const access = await requirePortalAccess();
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = await req.json().catch(() => null);
    const result = await recordPlanDecision(access.identity, body?.decision, body?.note);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
}
