import { handleBotRequest } from '@/lib/bots/handle';
import { liveBotDeps } from '@/lib/bots/live';

export const dynamic = 'force-dynamic';

/** POST /api/bots/timer/start — any bot key, existing tasks only. */
export async function POST(request: Request) {
    return handleBotRequest(request, liveBotDeps());
}
