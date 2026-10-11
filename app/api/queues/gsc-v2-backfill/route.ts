import { handleCallback } from '@vercel/queue';
import { parseBackfillQueueMessage } from '@/lib/gsc/backfill';
import { continueBackfill, runBackfillBatch } from '@/lib/gsc/backfill-session';
import { gscHistoryV2BackfillEnabled } from '@/lib/gsc/flags';
import { finishGscBackfillLock, gscBackfillLockHeldBy, touchGscBackfillLock } from '@/lib/supabase/gsc-background';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * One backfill batch, invoked by Vercel Queues. The hourly cron publishes the
 * first follow-up message; each batch publishes the next. The handler continues
 * a run only while that run's sync_runs lock is still held, and it ignores a
 * payload that is not a run id plus a chain number.
 */
export const POST = handleCallback(async (message) => {
    const parsed = parseBackfillQueueMessage(message);
    if (!parsed) return;
    if (process.env.GSC_HISTORY_ENABLED !== 'true' || !gscHistoryV2BackfillEnabled()) {
        if (await gscBackfillLockHeldBy(parsed.runId)) {
            await finishGscBackfillLock(parsed.runId, 'completed', 'backfill_disabled');
        }
        return;
    }
    if (!(await gscBackfillLockHeldBy(parsed.runId))) return;
    await touchGscBackfillLock(parsed.runId);
    const outcome = await runBackfillBatch(parsed.chain);
    await continueBackfill(parsed.chain, parsed.runId, outcome);
}, { visibilityTimeoutSeconds: 300 });
