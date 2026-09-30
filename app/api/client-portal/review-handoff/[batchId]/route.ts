import { NextRequest, NextResponse } from 'next/server';
import { mintReviewHandoff } from '@/lib/portal/actions';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

/**
 * Signed-in contacts open an in-review content batch on the existing
 * /review/[token] portal. The raw token is created here and only returned as
 * a redirect; it is not stored.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
    const access = await requirePortalAccess();
    if (!access.ok) {
        if (access.status === 401) {
            const login = new URL('/portal/login', req.url);
            login.searchParams.set('next', '/portal/pending');
            return NextResponse.redirect(login);
        }
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { batchId } = await params;
    const minted = await mintReviewHandoff(access.identity.contact, batchId, access.identity.userId);
    if (!minted.ok) {
        const message = minted.status === 429
            ? 'Too many review links were just created. Wait a few minutes and try again.'
            : 'That content review is not open.';
        return NextResponse.json({ error: message }, { status: minted.status });
    }
    return NextResponse.redirect(new URL(`/review/${minted.token}`, req.url));
}
