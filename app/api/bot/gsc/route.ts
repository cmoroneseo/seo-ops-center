import { handleBotGsc } from '@/lib/bot/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
    return handleBotGsc(request);
}
