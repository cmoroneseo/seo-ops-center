import { NextRequest, NextResponse } from 'next/server';
import { retryFailedPlanBasecampPushes } from '@/lib/seo-plan/basecamp-push-server';
import { enqueueConnectedGscJobs, runGscSyncWorker } from '@/lib/supabase/gsc-background';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Failed SEO Plan pushes retry on this existing daily schedule (10:00 UTC).
    // It runs even when Search Console history is off, and a failure here does
    // not skip the Search Console sync.
    let basecamp: { selected: number; ok: number; failed: number; skipped: number } | { error: string };
    try {
        basecamp = await retryFailedPlanBasecampPushes();
    } catch {
        basecamp = { error: 'Plan Basecamp retry will try again tomorrow.' };
    }
    if (process.env.GSC_HISTORY_ENABLED !== 'true') return NextResponse.json({ skipped: true, basecamp });
    try {
        // Historical v2 days run on /api/cron/backfill-gsc-history so this
        // invocation can spend its budget on the daily sync.
        await enqueueConnectedGscJobs();
        const daily = await runGscSyncWorker();
        return NextResponse.json({ daily, basecamp });
    } catch {
        return NextResponse.json({ error: 'Search performance sync will retry on the next run.', basecamp }, { status: 500 });
    }
}
