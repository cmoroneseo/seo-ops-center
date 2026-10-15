import { issueBotToken, listBotTokens } from '@/lib/bot/settings-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
    return listBotTokens(request);
}

export function POST(request: Request) {
    return issueBotToken(request);
}
