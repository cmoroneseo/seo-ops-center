import { handleCallback } from '@vercel/queue';
import { handleBingQueue } from '@/lib/bing/live';
import { parseBingQueueMessage } from '@/lib/bing/sync';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * One Bing site, invoked by Vercel Queues. The daily cron publishes the first
 * message; each site publishes the next. A payload that is not a run id plus
 * a chain number is ignored.
 *
 * Next.js route handlers must accept `Request`. `handleCallback` also accepts
 * `{ request }`, which the App Router type check rejects, so the export
 * forwards the request itself.
 */
const handleQueueMessage = handleCallback(async (message) => {
    if (!parseBingQueueMessage(message)) return;
    await handleBingQueue(message);
}, { visibilityTimeoutSeconds: 300 });

export function POST(request: Request) {
    return handleQueueMessage(request);
}
