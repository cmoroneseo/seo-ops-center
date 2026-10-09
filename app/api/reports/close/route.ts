import { closeRouteDeps, createCloseHandler } from '@/lib/reports/close-route';

export const dynamic = 'force-dynamic';

const get = createCloseHandler(closeRouteDeps());

export function GET(request: Request) {
    return get(request);
}
