import { NextRequest, NextResponse } from 'next/server';
import { gscRowConnected, keywordPositionsPayload } from '@/lib/onboarding/keyword-positions';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadArchitectGscQueries } from '@/lib/topical-map/architect-gsc';
import type { SearchReportingAdmin } from '@/lib/search-reporting/load';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const auth = await requireClientOrgMember(clientId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = createAdminClient();
    const integration = await admin
        .from('client_integrations')
        .select('site_url:credentials->>site_url, sync_status')
        .eq('organization_id', auth.organizationId)
        .eq('client_id', auth.clientId)
        .eq('service', 'gsc')
        .maybeSingle();
    if (integration.error) {
        return NextResponse.json({ error: 'Unable to read Search Console' }, { status: 500 });
    }

    const connected = gscRowConnected(integration.data as { site_url?: unknown; sync_status?: unknown } | null);
    if (!connected) return NextResponse.json(keywordPositionsPayload({ connected: false, queries: [] }));

    const queries = await loadArchitectGscQueries(admin as unknown as SearchReportingAdmin, {
        organizationId: auth.organizationId,
        clientId: auth.clientId,
    });
    return NextResponse.json(keywordPositionsPayload({ connected: true, queries }));
}
