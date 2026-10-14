import { NextRequest, NextResponse } from 'next/server';
import { handleBingCron } from '@/lib/bing/live';
import { logBingSyncSummary, summarizeBingCron } from '@/lib/bing/log';
import { cronAuthorized } from '@/lib/bing/run';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Daily Bing Webmaster sync.
 *
 * One wake at 12:00 UTC. Hour 10 is the Search Console daily sync. Hour 16
 * is report sending. Hour 12 overlaps only the hourly Search Console
 * backfill, which already occupies every hour.
 *
 * This lists verified sites once, maps them onto active clients, and publishes
 * one queue message. Each message syncs one site — three reads, then
 * replace_bing_snapshot — and publishes the next. The queue invokes a
 * separate function, so this deployment never calls its own URL.
 *
 * BING_WEBMASTER must be the exact string true, the org allowlist must be
 * non-empty, and BING_WEBMASTER_API_KEY must be set. Otherwise this returns
 * without calling Bing or writing snapshots.
 */
export async function GET(req: NextRequest) {
    if (!cronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await handleBingCron();
    logBingSyncSummary(summarizeBingCron(result));
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result);
}
