import { createRecordsHandlers, recordsRouteDeps } from '@/lib/topical-map/records-route';

export const runtime = 'nodejs';

const handlers = createRecordsHandlers(recordsRouteDeps());

export async function GET(request: Request) {
    return handlers.get(request);
}

export async function POST(request: Request) {
    return handlers.post(request);
}

export async function PATCH(request: Request) {
    return handlers.patch(request);
}
