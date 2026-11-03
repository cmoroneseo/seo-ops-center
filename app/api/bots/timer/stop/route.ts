import { handleBotRequest } from '@/lib/bots/handle';
import { liveBotDeps } from '@/lib/bots/live';

export const dynamic = 'force-dynamic';

/** POST /api/bots/timer/stop — closes this bot's running timer. */
export async function POST(request: Request) {
    return handleBotRequest(request, liveBotDeps());
}
