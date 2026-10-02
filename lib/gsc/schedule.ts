import { after } from 'next/server';
import { enqueueGscSync, runGscSyncWorker } from '@/lib/supabase/gsc-background';

/** Keep Google requests off the page-response path. Cron recovers interrupted work. */
export function scheduleGscSync(organizationId: string, clientId: string) {
    if (process.env.GSC_HISTORY_ENABLED !== 'true') return;
    after(async () => {
        try {
            if (await enqueueGscSync(organizationId, clientId)) {
                await runGscSyncWorker({ clientId, budgetMs: 80000 });
            }
        } catch {
            console.warn('GSC background sync deferred to its next scheduled run');
        }
    });
}
