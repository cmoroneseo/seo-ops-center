import { after } from 'next/server';
import { enqueueGscSync, enqueueGscV2Backfill, runGscSyncWorker } from '@/lib/supabase/gsc-background';
import { gscHistoryV2BackfillEnabled } from '@/lib/gsc/flags';

/** Keep Google requests off the page-response path. Cron recovers interrupted work. */
export function scheduleGscSync(organizationId: string, clientId: string) {
    if (process.env.GSC_HISTORY_ENABLED !== 'true') return;
    after(async () => {
        try {
            const queued = await enqueueGscSync(organizationId, clientId);
            // Enqueue only. A page view must not start the 16-month refetch.
            if (gscHistoryV2BackfillEnabled()) await enqueueGscV2Backfill(organizationId, clientId);
            if (queued) await runGscSyncWorker({ clientId, budgetMs: 80000 });
        } catch {
            console.warn('GSC background sync deferred to its next scheduled run');
        }
    });
}
