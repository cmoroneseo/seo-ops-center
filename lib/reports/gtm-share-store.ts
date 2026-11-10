import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { requireReportAccess } from './access';
import { getReport } from './reportStore';
import { missingKindColumn, newPublicToken, snapshotFromFrozenVersion, type PublicLinkKind, type PublicShareRow } from './gtm-share';

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function missingTable(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}

function shareRow(data: {
    token_hash: unknown;
    revoked_at: unknown;
    expires_at: unknown;
    snapshot: unknown;
    kind?: unknown;
    organization_id?: unknown;
    client_id?: unknown;
    report_id?: unknown;
}): PublicShareRow {
    return {
        tokenHash: String(data.token_hash),
        revokedAt: data.revoked_at ? String(data.revoked_at) : null,
        expiresAt: data.expires_at ? String(data.expires_at) : null,
        snapshot: data.snapshot,
        kind: typeof data.kind === 'string' ? data.kind : null,
        organizationId: typeof data.organization_id === 'string' ? data.organization_id : null,
        clientId: typeof data.client_id === 'string' ? data.client_id : null,
        reportId: typeof data.report_id === 'string' ? data.report_id : null,
    };
}

export async function findPublicShareByHash(hash: string): Promise<PublicShareRow | null> {
    const admin = createAdminClient();
    const full = await admin.from('report_public_links')
        .select('token_hash, revoked_at, expires_at, snapshot, kind, organization_id, client_id, report_id')
        .eq('token_hash', hash)
        .maybeSingle();
    if (full.error && missingKindColumn(full.error)) {
        const legacy = await admin.from('report_public_links')
            .select('token_hash, revoked_at, expires_at, snapshot')
            .eq('token_hash', hash)
            .maybeSingle();
        if (legacy.error || !legacy.data) return null;
        return shareRow(legacy.data);
    }
    if (full.error || !full.data) return null;
    return shareRow(full.data);
}

export async function listPublicShares(reportId: string, kind: PublicLinkKind = 'events'): Promise<Response> {
    const access = await requireReportAccess(reportId, 'read', { getReport, requireOrganizationMember });
    if (!access.ok) return json({ error: access.error }, access.status);
    const admin = createAdminClient();
    let result = await admin.from('report_public_links')
        .select('id, created_at, revoked_at, expires_at')
        .eq('report_id', access.report.id)
        .eq('organization_id', access.report.organization_id)
        .eq('kind', kind)
        .order('created_at', { ascending: false });
    if (result.error && missingKindColumn(result.error)) {
        if (kind !== 'events') return json({ links: [], migrationRequired: true });
        result = await admin.from('report_public_links')
            .select('id, created_at, revoked_at, expires_at')
            .eq('report_id', access.report.id)
            .eq('organization_id', access.report.organization_id)
            .order('created_at', { ascending: false });
    }
    const { data, error } = result;
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
    const legacy = {
        organization_id: access.report.organization_id,
        client_id: access.report.client_id,
        report_id: access.report.id,
        version_id: versionId,
        token_hash: tokenHash,
        snapshot,
        created_by: access.auth.userId,
    };
    let inserted = await admin.from('report_public_links').insert({ ...legacy, kind: 'events' }).select('id').single();
    if (inserted.error && missingKindColumn(inserted.error)) {
        inserted = await admin.from('report_public_links').insert(legacy).select('id').single();
    }
    if (inserted.error || !inserted.data) {
        if (missingTable(inserted.error)) return json({ error: 'Apply migration 122 before creating a public link.' }, 503);
        return json({ error: 'Could not create a public link.' }, 500);
    }
    return json({ id: String(inserted.data.id), url: `${origin}/events/${token}` });
}

export async function revokePublicShare(reportId: string, linkId: string, kind: PublicLinkKind = 'events'): Promise<Response> {
    const access = await requireReportAccess(reportId, 'write', { getReport, requireOrganizationMember });
    if (!access.ok) return json({ error: access.error }, access.status);
    const admin = createAdminClient();
    const base = () => admin.from('report_public_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', linkId)
        .eq('report_id', access.report.id)
        .eq('organization_id', access.report.organization_id)
        .is('revoked_at', null);
    let result = await base().eq('kind', kind).select('id');
    if (result.error && missingKindColumn(result.error)) {
        if (kind !== 'events') return json({ error: 'Roadmap links are not available yet.' }, 503);
        result = await base().select('id');
    }
    const { data, error } = result;
    if (error) {
        if (missingTable(error)) return json({ error: 'Apply migration 122 before revoking a public link.' }, 503);
        return json({ error: 'Could not revoke the public link.' }, 500);
    }
    if (!data?.length) return json({ error: 'That link is already inactive.' }, 404);
    return json({ ok: true });
}
