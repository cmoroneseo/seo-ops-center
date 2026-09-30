import { NextRequest, NextResponse } from 'next/server';
import { setPortalClientCookie } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const result = await setPortalClientCookie(String(body?.clientId ?? ''));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
}
