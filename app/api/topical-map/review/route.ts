import { createReviewHandlers, reviewRouteDeps } from '@/lib/topical-map/review-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createReviewHandlers(reviewRouteDeps());

export async function GET(request: Request) {
    return handlers.get(request);
}
