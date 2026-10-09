import { reportDraftHandler } from '@/lib/reports/report-drafts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily on purpose. Hobby rejects sub-daily crons. 15:00 UTC is still the
 * same Pacific calendar day, so business day 3 is the day this runs.
 * REPORT_AUTODRAFT_ENABLED must be the string true. Nothing is emailed.
 */
const handle = reportDraftHandler();

export function GET(request: Request) {
    return handle(request);
}

export function POST(request: Request) {
    return handle(request);
}
