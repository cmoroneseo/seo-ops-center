import { NextRequest, NextResponse } from 'next/server';
import { loginPortalEmail } from '@/lib/portal/actions';

export const dynamic = 'force-dynamic';

/** Always the same response, whether or not the address is a client contact. */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);
        await loginPortalEmail(body?.email, body?.next, body?.clientId);
    } catch {
        // Same reply whether the address is unknown or the mailer is down.
    }
    return NextResponse.json({
        ok: true,
        message: 'If this email is on a client portal, a sign-in link is on its way.',
    });
}
