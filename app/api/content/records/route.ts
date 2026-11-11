import { createContentHandlers, contentRouteDeps } from '@/lib/content/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createContentHandlers(contentRouteDeps());

export async function POST(request: Request) {
    return handlers.approve(request);
}

export async function PATCH(request: Request) {
    return handlers.update(request);
}
