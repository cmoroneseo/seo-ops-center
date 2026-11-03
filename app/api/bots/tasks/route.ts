import { handleBotRequest } from '@/lib/bots/handle';
import { liveBotDeps } from '@/lib/bots/live';

export const dynamic = 'force-dynamic';

/** POST /api/bots/tasks — seo-manager key only. */
export async function POST(request: Request) {
    return handleBotRequest(request, liveBotDeps());
}
