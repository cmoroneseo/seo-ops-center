import { NextRequest } from 'next/server';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { parseGtmReportSettings } from '@/lib/reports/gtm-events';
import { readGtmReportSettings, saveGtmReportSettings } from '@/lib/reports/gtm-events-routes';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const auth = await requireClientOrgMember(id);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    try {
        const settings = await readGtmReportSettings(auth.organizationId, auth.clientId);
        return json({ settings });
    } catch {
        return json({ error: 'Could not load event report settings.' }, 500);
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const auth = await requireClientOrgMember(id);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const body = await req.json().catch(() => null);
    const parsed = parseGtmReportSettings(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const saved = await saveGtmReportSettings(auth.organizationId, auth.clientId, parsed.settings);
    if (!saved.ok) return json({ error: saved.error }, saved.status);
    return json({ settings: parsed.settings });
}
