import { NextRequest, NextResponse } from 'next/server';
import {
    loadStaffPortal, staffInvite, staffRevoke, staffSharePlan, staffShareReport, staffWaiting,
} from '@/lib/portal/staff';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const result = await loadStaffPortal(req.nextUrl.searchParams.get('clientId'));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const action = record.action;
    const result = action === 'invite' ? await staffInvite(record)
        : action === 'revoke' ? await staffRevoke(record)
        : action === 'share_plan' ? await staffSharePlan(record, 'share')
        : action === 'unshare_plan' ? await staffSharePlan(record, 'unshare')
        : action === 'request_plan_again' ? await staffSharePlan(record, 'again')
        : action === 'share_report' ? await staffShareReport(record, true)
        : action === 'unshare_report' ? await staffShareReport(record, false)
        : action === 'add_waiting' ? await staffWaiting(record, false)
        : action === 'resolve_waiting' ? await staffWaiting(record, true)
        : { ok: false as const, status: 400, error: 'Unknown action' };

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
}
