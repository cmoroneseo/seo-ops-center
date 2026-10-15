import { revokeBotToken } from '@/lib/bot/settings-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
    return revokeBotToken(request);
}
