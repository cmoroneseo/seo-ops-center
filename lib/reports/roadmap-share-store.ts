import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { requireReportAccess } from './access';
import { missingKindColumn, newPublicToken } from './gtm-share';
import { listPublicShares, revokePublicShare } from './gtm-share-store';
import { getReport } from './reportStore';
import { latestRoadmapSections } from './roadmap-public';
import { loadRoadmapShareSources } from './roadmap-server';

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function missingTable(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function listRoadmapShares(reportId: string): Promise<Response> {
    return listPublicShares(reportId, 'roadmap');
}

export async function revokeRoadmapShare(reportId: string, linkId: string): Promise<Response> {
    return revokePublicShare(reportId, linkId, 'roadmap');
}

export async function createRoadmapShare(reportId: string, origin: string): Promise<Response> {
    const access = await requireReportAccess(reportId, 'write', { getReport, requireOrganizationMember });
    if (!access.ok) return json({ error: access.error }, access.status);
    if (!access.report.client_id) return json({ error: 'Assign a client before sharing this plan.' }, 409);

    const admin = createAdminClient();
    let sources;
    try {
        sources = await loadRoadmapShareSources(admin, {
            organizationId: access.report.organization_id,
            clientId: access.report.client_id,
            reportId: access.report.id,
        });
    } catch {
        return json({ error: 'Could not load the report.' }, 500);
    }

    const picked = latestRoadmapSections(sources);
    if (!picked) {
        if (sources.share === 'error' || sources.frozen === 'error') {
            return json({ error: 'Could not load the report.' }, 500);
        }
        if (sources.share === 'missing' && sources.frozen === 'missing') {
            return json({ error: 'Approve the report, or share it with the client, before creating this link.' }, 409);
        }
        return json({ error: 'Add the roadmap, then approve or share the report, before creating this link.' }, 409);
    }

    const { token, tokenHash } = newPublicToken();
    const inserted = await admin.from('report_public_links').insert({
        organization_id: access.report.organization_id,
        client_id: access.report.client_id,
        report_id: access.report.id,
        version_id: picked.versionId,
        token_hash: tokenHash,
        snapshot: null,
        kind: 'roadmap',
        created_by: access.auth.userId,
    }).select('id').single();
    if (inserted.error || !inserted.data) {
        const code = inserted.error?.code;
        if (missingTable(inserted.error) || missingKindColumn(inserted.error) || code === '23502' || code === '23514') {
            return json({ error: 'Roadmap links are not available yet.' }, 503);
        }
        return json({ error: 'Could not create a roadmap link.' }, 500);
    }
    return json({ id: String(inserted.data.id), url: `${origin}/roadmap/${token}` });
}
