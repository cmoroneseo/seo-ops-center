import { handleCallback } from '@vercel/queue';
import { handleMirrorQueue } from '@/lib/sheets-mirror/live';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const handleQueueMessage = handleCallback(handleMirrorQueue, { visibilityTimeoutSeconds: 300 });

export function POST(request: Request) {
    return handleQueueMessage(request);
}
