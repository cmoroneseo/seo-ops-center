import { handleBotRequest } from '@/lib/bots/handle';
import { liveBotDeps } from '@/lib/bots/live';

export const dynamic = 'force-dynamic';

/** POST /api/bots/timer/resume — opens a new stretch on a paused entry. */
export async function POST(request: Request) {
    return handleBotRequest(request, liveBotDeps());
}
