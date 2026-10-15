import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrganizationAdmin } from '@/lib/security/tenant-authz';
import { executeGoogleTokenBackfill, type IntegrationSecretRow } from './google-token-backfill';
import { readKeyRing } from './google-token-crypto';

const bodyShape = z.object({
    organizationId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    dryRun: z.boolean().optional(),
    verify: z.boolean().optional(),
}).strict();

/**
 * Owner/admin backfill. Dry-run is the default. The response is counts and
 * failure codes, never credential material.
 */
export async function postGoogleTokenEncryption(request: Request): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        body = null;
    }
    const parsed = bodyShape.safeParse(body);
    if (!parsed.success) {
        return Response.json({ error: 'Invalid request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const actor = await requireOrganizationAdmin(parsed.data.organizationId);
    if (!actor.ok) {
        return Response.json({ error: actor.error }, { status: actor.status, headers: { 'Cache-Control': 'no-store' } });
    }

    const ring = readKeyRing();
    const dryRun = parsed.data.dryRun !== false;
    const verify = parsed.data.verify === true;
    const admin = createAdminClient();
    let rows: IntegrationSecretRow[];
    try {
        rows = await loadRows(admin, actor.organizationId);
    } catch {
        return Response.json({ error: 'Unable to read integrations' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!ring) {
        const report = await executeGoogleTokenBackfill({ rows, ring: null, dryRun: true, verify: false });
        return Response.json({ error: 'GOOGLE_TOKEN_ENC_KEY is not configured', ...report }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const report = await executeGoogleTokenBackfill({
        rows,
        ring,
        dryRun,
        verify,
        write: async (row, next) => {
            const { data, error } = await admin
                .from('client_integrations')
                .update({ credentials: next })
                .eq('id', row.id)
                .eq('organization_id', actor.organizationId)
                .filter('credentials', 'eq', JSON.stringify(row.credentials))
                .select('id')
                .maybeSingle();
            return error || !data ? 'conflict' : 'updated';
        },
        reread: async (row) => {
            const { data, error } = await admin
                .from('client_integrations')
                .select('credentials')
                .eq('id', row.id)
                .eq('organization_id', actor.organizationId)
                .maybeSingle();
            if (error) throw new Error('Unable to reread integration');
            return data?.credentials ?? null;
        },
    });
    return Response.json(report, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

async function loadRows(admin: ReturnType<typeof createAdminClient>, organizationId: string): Promise<IntegrationSecretRow[]> {
    const rows: IntegrationSecretRow[] = [];
    for (let from = 0; from < 20_000; from += 500) {
        const { data, error } = await admin
            .from('client_integrations')
            .select('id, organization_id, client_id, service, credentials')
            .eq('organization_id', organizationId)
            .order('id')
            .range(from, from + 499);
        if (error) throw new Error('Unable to read integrations');
        for (const row of data ?? []) {
            rows.push({
                id: String(row.id),
                organizationId: String(row.organization_id),
                clientId: String(row.client_id),
                service: String(row.service),
                credentials: row.credentials,
            });
        }
        if ((data ?? []).length < 500) break;
    }
    return rows;
}
