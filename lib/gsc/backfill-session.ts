import {
    BACKFILL_QUEUE_FAILURE_NOTICE, backfillWorkRemains, nextBackfillQueueMessage, shouldContinueBackfill,
} from './backfill';
import { enqueueGscBackfillContinuation } from './backfill-queue';
import {
    enqueueConnectedGscJobs, finishGscBackfillLock, listGscV2BackfillProgress, recordGscBackfillProgress,
    runGscV2BackfillWorker, type GscBackfillWorkerResult,
} from '@/lib/supabase/gsc-background';

export function backfillLockStatus(result: GscBackfillWorkerResult): 'completed' | 'partial' | 'failed' {
    if (result.quotaPaused || (result.failed > 0 && result.imported > 0)) return 'partial';
    if (result.failed > 0) return 'failed';
    return 'completed';
}

export function backfillClientSummary(progress: Awaited<ReturnType<typeof listGscV2BackfillProgress>>) {
    return progress.map(row => ({
        clientId: row.clientId,
        daysDone: row.daysDone,
        daysTotal: row.daysTotal,
        status: row.status,
        cursorDate: row.cursorDate,
    }));
}

export async function runBackfillBatch(chain: number) {
    const started = Date.now();
    await enqueueConnectedGscJobs();
    const result = await runGscV2BackfillWorker();
    const progress = await listGscV2BackfillProgress();
    await recordGscBackfillProgress({
        imported: result.imported,
        failed: result.failed,
        skipped: result.skipped,
        notices: result.notices,
        progress,
    });
    console.info(JSON.stringify({
        event: 'gsc_v2_backfill',
        chain,
        imported: result.imported,
        failed: result.failed,
        skipped: result.skipped,
        quotaPaused: result.quotaPaused,
        clients: backfillClientSummary(progress),
    }));
    const continueChain = shouldContinueBackfill({
        chain,
        imported: result.imported,
        quotaPaused: result.quotaPaused,
        workRemains: backfillWorkRemains(progress, Date.now()),
    });
    return { result, progress, continueChain, elapsedMs: Date.now() - started };
}

/** Publish the next batch, or release the lock when this run should stop. */
export async function continueBackfill(
    chain: number,
    runId: string,
    outcome: Awaited<ReturnType<typeof runBackfillBatch>>,
): Promise<boolean> {
    const next = nextBackfillQueueMessage({
        runId,
        chain,
        elapsedMs: outcome.elapsedMs,
        continueChain: outcome.continueChain,
    });
    if (!next) {
        await finishGscBackfillLock(runId, backfillLockStatus(outcome.result));
        return false;
    }
    try {
        await enqueueGscBackfillContinuation(next);
        return true;
    } catch (error) {
        const name = error instanceof Error ? error.name : 'Error';
        console.warn(`gsc_v2_backfill ${BACKFILL_QUEUE_FAILURE_NOTICE} ${name}`);
        await finishGscBackfillLock(runId, backfillLockStatus(outcome.result), BACKFILL_QUEUE_FAILURE_NOTICE);
        return false;
    }
}
