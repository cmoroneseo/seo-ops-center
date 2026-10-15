import { NextRequest, NextResponse } from 'next/server';
import { handleGa4Cron } from '@/lib/ga4/live';
import { cronAuthorized } from '@/lib/ga4/run';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Nightly GA4 sync at 11:00 UTC, after the 10:00 Search Console sync.
 *
 * GA4_HISTORY_ENABLED must be the exact string true and GA4_ORG_IDS must list
 * the organization. Otherwise this returns without calling Google. The cron
 * enqueues the last-3-day pull and, when GA4_BACKFILL_ENABLED is also true,
 * the 16-month backfill. One queue message handles one property, then
 * publishes the next. This deployment does not call its own URL.
 */
export async function GET(req: NextRequest) {
    if (!cronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await handleGa4Cron();
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result);
}
