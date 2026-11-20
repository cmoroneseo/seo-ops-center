import { handleBotClientLookup } from '@/lib/bots/client-lookup';

export const dynamic = 'force-dynamic';

/** GET /api/bots/clients — look up clients in the bot key's organization. */
export async function GET(request: Request) {
    return handleBotClientLookup(request);
}
