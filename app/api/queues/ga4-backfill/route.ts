import { handleCallback } from '@vercel/queue';
import { parseGa4QueueMessage } from '@/lib/ga4/backfill';
import { handleGa4Queue } from '@/lib/ga4/live';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * One GA4 property, invoked by Vercel Queues. A daily message re-pulls the
 * last three days. A backfill message pulls one calendar month. A payload
 * that is not a run id, a chain number, and a kind is ignored.
 */
const handleQueueMessage = handleCallback(async (message) => {
    if (!parseGa4QueueMessage(message)) return;
    await handleGa4Queue(message);
}, { visibilityTimeoutSeconds: 300 });

export function POST(request: Request) {
    return handleQueueMessage(request);
}
