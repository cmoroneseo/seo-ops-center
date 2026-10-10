import { NextRequest, NextResponse } from 'next/server';
import { enqueueConnectedGscJobs, runGscSyncWorker } from '@/lib/supabase/gsc-background';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (process.env.GSC_HISTORY_ENABLED !== 'true') return NextResponse.json({ skipped: true });
    try {
        // Historical v2 days run on /api/cron/backfill-gsc-history so this
        // invocation can spend its budget on the daily sync.
        await enqueueConnectedGscJobs();
        const daily = await runGscSyncWorker();
        return NextResponse.json({ daily });
    } catch {
        return NextResponse.json({ error: 'Search performance sync will retry on the next run.' }, { status: 500 });
    }
}
