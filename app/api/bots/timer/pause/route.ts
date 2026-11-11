import { handleBotRequest } from '@/lib/bots/handle';
import { liveBotDeps } from '@/lib/bots/live';

export const dynamic = 'force-dynamic';

/** POST /api/bots/timer/pause — closes the open stretch and leaves the entry paused. */
export async function POST(request: Request) {
    return handleBotRequest(request, liveBotDeps());
}
