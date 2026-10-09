import { reportSendHandler } from '@/lib/reports/report-sends';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Two daily crons, 16:00 and 17:00 UTC. Hobby rejects sub-daily schedules.
 * 16:00 UTC is 9:00 AM Pacific while daylight-saving time is in effect.
 * 17:00 UTC is 9:00 AM Pacific after it ends. The handler sends only when
 * the Pacific hour is 9 and the day is a business day.
 * REPORT_SEND_ENABLED must be the string true. Anything else queues nothing.
 */
const handle = reportSendHandler();

export function GET(request: Request) {
    return handle(request);
}

export function POST(request: Request) {
    return handle(request);
}
