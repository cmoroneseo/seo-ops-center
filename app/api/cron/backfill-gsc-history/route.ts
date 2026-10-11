import { NextRequest, NextResponse } from 'next/server';
import { backfillWorkRemains } from '@/lib/gsc/backfill';
import { backfillClientSummary, continueBackfill, runBackfillBatch } from '@/lib/gsc/backfill-session';
import { gscHistoryV2BackfillEnabled } from '@/lib/gsc/flags';
import {
    closeStaleGscBackfillLocks, enqueueConnectedGscJobs, finishGscBackfillLock,
    firstConnectedGscOrganizationId, gscBackfillLockIsHeld, listGscV2BackfillProgress, openGscBackfillLock,
} from '@/lib/supabase/gsc-background';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Historical Search Console backfill.
 *
 * Hobby cron can run once per day per expression, so vercel.json registers one
 * wake per hour. Each wake saves a batch inside this function, then publishes
 * the next batch to the gsc-v2-backfill queue. The queue invokes a separate
 * function, so the deployment never calls its own URL (that self-call is what
 * Vercel answers with HTTP 508 after a handful of hops). A live sync_runs lock
 * keeps the next hour from starting a second run. A failed publish is stored
 * on that lock as error_summary.message = continuation_queue_failed.
 * Idle jobs with a future available_at (parked demos, quota backoff, missing
 * Google tokens) are not claimed.
 *
 * Days saved out of 486, per client:
 *   select client_id, status, cursor_date,
 *     case when cursor_date is null then 0
 *       else greatest(0, least(486,
 *         ((now() at time zone 'America/Los_Angeles')::date - cursor_date) + 1))
 *     end as days_done,
 *     486 as days_total
 *   from gsc_sync_jobs
 *   where kind = 'v2_backfill'
 *   order by client_id;
 * The same snapshot is written to sync_runs.source_outcomes where service = 'gsc_v2_backfill'.
 */

function authorized(req: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (process.env.GSC_HISTORY_ENABLED !== 'true' || !gscHistoryV2BackfillEnabled()) {
        return NextResponse.json({ skipped: true, reason: 'backfill_disabled' });
    }

    try {
        await closeStaleGscBackfillLocks();
        if (await gscBackfillLockIsHeld()) return NextResponse.json({ skipped: true, reason: 'already_running' });
        await enqueueConnectedGscJobs();
        const queued = await listGscV2BackfillProgress();
        if (!backfillWorkRemains(queued, Date.now())) {
            return NextResponse.json({ skipped: true, reason: 'idle', clients: backfillClientSummary(queued) });
        }
        const organizationId = queued.find(row => row.daysDone < row.daysTotal)?.organizationId
            ?? await firstConnectedGscOrganizationId();
        if (!organizationId) return NextResponse.json({ skipped: true, reason: 'nothing_to_sync' });
        const runId = await openGscBackfillLock(organizationId);
        try {
            const outcome = await runBackfillBatch(0);
            const continued = await continueBackfill(0, runId, outcome);
            return NextResponse.json({
                imported: outcome.result.imported,
                failed: outcome.result.failed,
                skipped: outcome.result.skipped,
                quotaPaused: outcome.result.quotaPaused,
                chain: 0,
                continued,
                clients: backfillClientSummary(outcome.progress),
            });
        } catch {
            await finishGscBackfillLock(runId, 'failed');
            return NextResponse.json({ error: 'Search performance backfill will retry on the next run.' }, { status: 500 });
        }
    } catch {
        return NextResponse.json({ error: 'Search performance backfill will retry on the next run.' }, { status: 500 });
    }
}
