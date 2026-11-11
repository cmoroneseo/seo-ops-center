import { NextRequest, NextResponse } from 'next/server';

import { capOverdueBotTimers } from '@/lib/bots/handle';
import { liveBotDeps } from '@/lib/bots/live';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET|POST /api/cron/cap-bot-timers
 *
 * Stops bot timers whose cumulative running time is longer than two hours.
 * Paused time does not count, and a paused timer is not closed. Timers paused
 * for seven days are returned as stalePaused for review. A capped entry is
 * needs_review and is not sent to Basecamp.
 *
 * The same cap runs on the next call from that bot. This sweep is for a bot
 * that never calls back. Vercel Hobby allows each cron path once a day, so a
 * forgotten timer can sit until this run; the saved duration is still two hours
 * from when it started, not from when the sweep noticed.
 *
 * Auth: Bearer CRON_SECRET only.
 */
function isAuthorized(req: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const result = await capOverdueBotTimers(liveBotDeps());
        return NextResponse.json(result);
    } catch (error) {
        console.error('[cron] cap-bot-timers failed:', error);
        return NextResponse.json({ error: 'Bot timer cap failed' }, { status: 500 });
    }
}

export const GET = run;
export const POST = run;
