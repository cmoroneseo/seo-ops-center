import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { startSiteCrawl } from '@/lib/site-inventory/runner';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
    let body: { clientId?: unknown; urlLimit?: unknown };
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }); }
    const auth = await requireClientOrgMember(body.clientId);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    if (auth.role === 'viewer') return Response.json({ error: 'Viewer access is read-only' }, { status: 403 });
    const urlLimit = body.urlLimit === undefined ? 200 : Number(body.urlLimit);
    if (!Number.isInteger(urlLimit) || urlLimit < 10 || urlLimit > 500) return Response.json({ error: 'URL limit must be between 10 and 500' }, { status: 400 });

    const admin = createAdminClient();
    const { data: client, error } = await admin.from('clients').select('domain').eq('id', auth.clientId).eq('organization_id', auth.organizationId).single();
    if (error) return Response.json({ error: 'Unable to read client website' }, { status: 500 });
    let site = typeof client?.domain === 'string' && client.domain.trim() ? client.domain.trim() : undefined;
    if (!site) {
        const { data: connection, error: connectionError } = await admin.from('client_integrations')
            .select('site_url:credentials->>site_url')
            .eq('organization_id', auth.organizationId)
            .eq('client_id', auth.clientId)
            .eq('service', 'gsc')
            .maybeSingle();
        if (connectionError) return Response.json({ error: 'Unable to read selected GSC property' }, { status: 500 });
        site = typeof connection?.site_url === 'string' && connection.site_url.trim() ? connection.site_url.trim() : undefined;
    }
    if (!site) return Response.json({ error: 'Add a client website or select a primary GSC property before starting a crawl' }, { status: 400 });
    try {
        const run = await startSiteCrawl(admin, { ...auth, domain: site, urlLimit });
        return Response.json({ run });
    } catch {
        console.error('[site-crawl] start failed');
        return Response.json({ error: 'Unable to start site crawl' }, { status: 500 });
    }
}
