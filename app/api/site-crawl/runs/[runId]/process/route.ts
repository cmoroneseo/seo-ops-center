import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { processSiteCrawlBatch } from '@/lib/site-inventory/runner';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
    let body: { clientId?: unknown };
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }); }
    const auth = await requireClientOrgMember(body.clientId);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    if (auth.role === 'viewer') return Response.json({ error: 'Viewer access is read-only' }, { status: 403 });
    const { runId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
        return Response.json({ error: 'Invalid crawl run' }, { status: 400 });
    }
    try {
        return Response.json(await processSiteCrawlBatch(createAdminClient(), { ...auth, runId }));
    } catch (error) {
        console.error('[site-crawl] batch failed');
        const message = error instanceof Error && error.message === 'Crawl run not found' ? error.message : 'Unable to continue site crawl';
        return Response.json({ error: message }, { status: message === 'Crawl run not found' ? 404 : 500 });
    }
}
