import { weeklyDigestHandler } from '@/lib/reports/weekly-digest-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * One daily cron at 16:00 UTC. Hobby rejects sub-daily schedules, so this
 * is a single daily entry. 16:00 UTC is Monday morning Pacific in both
 * daylight-saving time (9:00) and standard time (8:00). The handler
 * composes a new digest only when the Pacific calendar day is Monday.
 * WEEKLY_DIGEST_ENABLED must be the string true. Anything else queues
 * nothing and emails nothing.
 */
const handle = weeklyDigestHandler();

export function GET(request: Request) {
    return handle(request);
}

export function POST(request: Request) {
    return handle(request);
}
