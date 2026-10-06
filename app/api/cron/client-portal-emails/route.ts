import { NextRequest, NextResponse } from 'next/server';
import { deliverPortalEmails } from '@/lib/portal/email-delivery';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { return NextResponse.json(await deliverPortalEmails(20)); }
    catch { return NextResponse.json({ error: 'Could not process portal notifications' }, { status: 500 }); }
}
