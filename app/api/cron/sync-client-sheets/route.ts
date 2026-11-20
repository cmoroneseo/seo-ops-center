import { cronAuthorized } from '@/lib/bing/run';
import { handleMirrorCron } from '@/lib/sheets-mirror/live';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        return Response.json(await handleMirrorCron());
    } catch {
        return Response.json({ error: 'Could not schedule client sheet syncs' }, { status: 500 });
    }
}
