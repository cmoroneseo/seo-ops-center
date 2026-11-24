import { handleBotRequest } from '@/lib/bots/handle';
import { liveBotDeps } from '@/lib/bots/live';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    return handleBotRequest(request, liveBotDeps());
}
