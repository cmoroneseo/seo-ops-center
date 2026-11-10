import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { requireReportAccess } from './access';
import { getReport } from './reportStore';
import { newPublicToken, snapshotFromFrozenVersion, type PublicShareRow } from './gtm-share';

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function missingTable(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function findPublicShareByHash(hash: string): Promise<PublicShareRow | null> {
    const admin = createAdminClient();
    const { data, error } = await admin.from('report_public_links')
        .select('token_hash, revoked_at, expires_at, snapshot')
        .eq('token_hash', hash)
        .maybeSingle();
    if (error || !data) return null;
    return {
        tokenHash: String(data.token_hash),
        revokedAt: data.revoked_at ? String(data.revoked_at) : null,
        expiresAt: data.expires_at ? String(data.expires_at) : null,
        snapshot: data.snapshot,
    };
}

export async function listPublicShares(reportId: string): Promise<Response> {
    const access = await requireReportAccess(reportId, 'read', { getReport, requireOrganizationMember });
    if (!access.ok) return json({ error: access.error }, access.status);
    const admin = createAdminClient();
    const { data, error } = await admin.from('report_public_links')
        .select('id, created_at, revoked_at, expires_at')
        .eq('report_id', access.report.id)
        .eq('organization_id', access.report.organization_id)
        .order('created_at', { ascending: false });
    if (error) {
        if (missingTable(error)) return json({ links: [], migrationRequired: true });
        return json({ error: 'Could not load public links.' }, 500);
    }
    return json({
        links: (data ?? []).map(row => ({
            id: String(row.id),
            createdAt: String(row.created_at),
            revokedAt: row.revoked_at ? String(row.revoked_at) : null,
            expiresAt: row.expires_at ? String(row.expires_at) : null,
        })),
    });
}

export async function createPublicShare(reportId: string, origin: string): Promise<Response> {
    const access = await requireReportAccess(reportId, 'write', { getReport, requireOrganizationMember });
    if (!access.ok) return json({ error: access.error }, access.status);
    if (!access.report.client_id) return json({ error: 'Assign a client before sharing.' }, 409);
    const admin = createAdminClient();
    const review = await admin.from('report_reviews')
        .select('state, current_version_id')
        .eq('report_id', access.report.id)
        .eq('organization_id', access.report.organization_id)
        .maybeSingle();
    if (review.error) {
        if (missingTable(review.error)) return json({ error: 'Publish the report before creating a public link.' }, 409);
        return json({ error: 'Could not load the published report.' }, 500);
    }
    const state = review.data?.state;
    const versionId = review.data?.current_version_id ? String(review.data.current_version_id) : '';
    if (!versionId || (state !== 'approved' && state !== 'scheduled' && state !== 'sent')) {
        return json({ error: 'Publish the report before creating a public link.' }, 409);
    }
    const version = await admin.from('report_versions')
        .select('snapshot')
        .eq('id', versionId)
        .eq('report_id', access.report.id)
        .eq('organization_id', access.report.organization_id)
        .maybeSingle();
    if (version.error || !version.data) return json({ error: 'Could not load the published report.' }, 500);
    const snapshot = snapshotFromFrozenVersion(version.data.snapshot);
    if (!snapshot) return json({ error: 'Load events, then publish the report, before creating a public link.' }, 409);
    const { token, tokenHash } = newPublicToken();
    const inserted = await admin.from('report_public_links').insert({
        organization_id: access.report.organization_id,
        client_id: access.report.client_id,
        report_id: access.report.id,
        version_id: versionId,
        token_hash: tokenHash,
        snapshot,
        created_by: access.auth.userId,
    }).select('id').single();
    if (inserted.error || !inserted.data) {
        if (missingTable(inserted.error)) return json({ error: 'Apply migration 122 before creating a public link.' }, 503);
        return json({ error: 'Could not create a public link.' }, 500);
    }
    return json({ id: String(inserted.data.id), url: `${origin}/events/${token}` });
}

export async function revokePublicShare(reportId: string, linkId: string): Promise<Response> {
    const access = await requireReportAccess(reportId, 'write', { getReport, requireOrganizationMember });
    if (!access.ok) return json({ error: access.error }, access.status);
    const admin = createAdminClient();
    const { data, error } = await admin.from('report_public_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', linkId)
        .eq('report_id', access.report.id)
        .eq('organization_id', access.report.organization_id)
        .is('revoked_at', null)
        .select('id');
    if (error) {
        if (missingTable(error)) return json({ error: 'Apply migration 122 before revoking a public link.' }, 503);
        return json({ error: 'Could not revoke the public link.' }, 500);
    }
    if (!data?.length) return json({ error: 'That link is already inactive.' }, 404);
    return json({ ok: true });
}
