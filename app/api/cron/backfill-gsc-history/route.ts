import { after, NextRequest, NextResponse } from 'next/server';
import {
    backfillWorkRemains, chainGapMs, continuationAccepted, parseBackfillChain, shouldContinueBackfill,
} from '@/lib/gsc/backfill';
import { gscHistoryV2BackfillEnabled } from '@/lib/gsc/flags';
import {
    closeStaleGscBackfillLocks, enqueueConnectedGscJobs, finishGscBackfillLock,
    firstConnectedGscOrganizationId, gscBackfillLockHeldBy, gscBackfillLockIsHeld,
    listGscV2BackfillProgress, openGscBackfillLock, recordGscBackfillProgress,
    runGscV2BackfillWorker, touchGscBackfillLock, type GscBackfillWorkerResult,
} from '@/lib/supabase/gsc-background';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Historical Search Console backfill.
 *
 * Hobby cron can run once per day per expression, so vercel.json registers one
 * wake per hour. Each wake saves a few days, then kicks the next link after
 * the remainder of a 4-minute gap. A live sync_runs lock keeps the next hour
 * from starting a second chain. Idle jobs with a future available_at (parked
 * demos, quota backoff, missing Google tokens) are not claimed.
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

function continuationOrigin(): string {
    const host = process.env.VERCEL_URL;
    if (host && /^[a-z0-9.-]+$/i.test(host)) return `https://${host}`;
    return 'http://localhost:3000';
}

function continuationHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
    };
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) headers['x-vercel-protection-bypass'] = bypass;
    return headers;
}

async function kickBackfill(chain: number, runId: string): Promise<boolean> {
    const url = new URL('/api/cron/backfill-gsc-history', continuationOrigin());
    url.searchParams.set('chain', String(chain));
    url.searchParams.set('run', runId);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: continuationHeaders(),
            cache: 'no-store',
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000),
        });
        const body = await response.json().catch(() => null) as { skipped?: boolean } | null;
        if (!continuationAccepted(response.status, body)) {
            if (response.status >= 400) console.warn(`gsc_v2_backfill continuation returned HTTP ${response.status}`);
            return false;
        }
        return true;
    } catch {
        console.warn('gsc_v2_backfill continuation did not start');
        return false;
    }
}

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function lockStatus(result: GscBackfillWorkerResult): 'completed' | 'partial' | 'failed' {
    if (result.quotaPaused || (result.failed > 0 && result.imported > 0)) return 'partial';
    if (result.failed > 0) return 'failed';
    return 'completed';
}

function clientSummary(progress: Awaited<ReturnType<typeof listGscV2BackfillProgress>>) {
    return progress.map(row => ({
        clientId: row.clientId,
        daysDone: row.daysDone,
        daysTotal: row.daysTotal,
        status: row.status,
        cursorDate: row.cursorDate,
    }));
}

async function executeBackfill(chain: number) {
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
        clients: clientSummary(progress),
    }));
    const continueChain = shouldContinueBackfill({
        chain,
        imported: result.imported,
        quotaPaused: result.quotaPaused,
        workRemains: backfillWorkRemains(progress, Date.now()),
    });
    return { result, progress, continueChain, elapsedMs: Date.now() - started };
}

async function continueOrFinish(chain: number, runId: string, outcome: Awaited<ReturnType<typeof executeBackfill>>) {
    if (!outcome.continueChain) {
        await finishGscBackfillLock(runId, lockStatus(outcome.result));
        return;
    }
    const gap = chainGapMs(outcome.elapsedMs);
    if (gap > 0) await wait(gap);
    const started = await kickBackfill(chain + 1, runId);
    if (!started) await finishGscBackfillLock(runId, lockStatus(outcome.result));
}

export async function GET(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (process.env.GSC_HISTORY_ENABLED !== 'true' || !gscHistoryV2BackfillEnabled()) {
        return NextResponse.json({ skipped: true, reason: 'backfill_disabled' });
    }
    const chain = parseBackfillChain(req.nextUrl.searchParams.get('chain'));
    if (chain == null) return NextResponse.json({ error: 'Invalid backfill chain' }, { status: 400 });
    const runParam = req.nextUrl.searchParams.get('run');
    if (chain > 0 && (runParam == null || !RUN_ID.test(runParam))) {
        return NextResponse.json({ error: 'Invalid backfill run' }, { status: 400 });
    }

    if (chain > 0) {
        const runId = runParam as string;
        after(async () => {
            try {
                if (!(await gscBackfillLockHeldBy(runId))) return;
                await touchGscBackfillLock(runId);
                const outcome = await executeBackfill(chain);
                await continueOrFinish(chain, runId, outcome);
            } catch {
                console.warn('gsc_v2_backfill link failed');
                await finishGscBackfillLock(runId, 'failed');
            }
        });
        return NextResponse.json({ accepted: true, chain });
    }

    try {
        await closeStaleGscBackfillLocks();
        if (await gscBackfillLockIsHeld()) return NextResponse.json({ skipped: true, reason: 'already_running' });
        await enqueueConnectedGscJobs();
        const queued = await listGscV2BackfillProgress();
        if (!backfillWorkRemains(queued, Date.now())) {
            return NextResponse.json({ skipped: true, reason: 'idle', clients: clientSummary(queued) });
        }
        const organizationId = queued.find(row => row.daysDone < row.daysTotal)?.organizationId
            ?? await firstConnectedGscOrganizationId();
        if (!organizationId) return NextResponse.json({ skipped: true, reason: 'nothing_to_sync' });
        const runId = await openGscBackfillLock(organizationId);
        try {
            const outcome = await executeBackfill(0);
            if (outcome.continueChain) {
                after(async () => {
                    try {
                        await continueOrFinish(0, runId, outcome);
                    } catch {
                        console.warn('gsc_v2_backfill continuation did not start');
                        await finishGscBackfillLock(runId, 'partial');
                    }
                });
            } else {
                await finishGscBackfillLock(runId, lockStatus(outcome.result));
            }
            return NextResponse.json({
                imported: outcome.result.imported,
                failed: outcome.result.failed,
                skipped: outcome.result.skipped,
                quotaPaused: outcome.result.quotaPaused,
                chain: 0,
                continued: outcome.continueChain,
                clients: clientSummary(outcome.progress),
            });
        } catch {
            await finishGscBackfillLock(runId, 'failed');
            return NextResponse.json({ error: 'Search performance backfill will retry on the next run.' }, { status: 500 });
        }
    } catch {
        return NextResponse.json({ error: 'Search performance backfill will retry on the next run.' }, { status: 500 });
    }
}
