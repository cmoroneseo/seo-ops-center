import { liveBotTimeDeps } from '@/lib/bots/live';
import { handleBotTimeRequest } from '@/lib/bots/time-entry';

export const dynamic = 'force-dynamic';

/** POST /api/bots/time — scoped bot key, not a user session. */
export async function POST(request: Request) {
    return handleBotTimeRequest(request, liveBotTimeDeps());
}
