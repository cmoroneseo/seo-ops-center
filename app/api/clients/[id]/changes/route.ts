import { NextResponse } from 'next/server';

import { CHANGE_LOG_READ_ONLY, canEditChangeLog } from '@/lib/change-log/access';
import { createChange, listChanges, missingTable } from '@/lib/change-log/store';
import { normalizeChange, validateChange, type ChangeInput } from '@/lib/change-log/validate';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await requireClientOrgMember(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    try {
        const result = await listChanges(access.organizationId, access.clientId);
        return json({ setup: result.setup, items: result.items, canEdit: canEditChangeLog(access.role) });
    } catch (error) {
        if (missingTable(error)) return json({ setup: 'missing', items: [] });
        return json({ error: 'Unable to load the change log.' }, 500);
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await requireClientOrgMember(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    if (!canEditChangeLog(access.role)) return json({ error: CHANGE_LOG_READ_ONLY }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Check the form and try again.' }, 400);
    const input = body as ChangeInput;
    const problem = validateChange(input);
    if (problem) return json({ error: problem }, 400);
    const change = normalizeChange(input);
    if (!change) return json({ error: 'Check the form and try again.' }, 400);
    try {
        const saved = await createChange({
            organizationId: access.organizationId,
            clientId: access.clientId,
            userId: access.userId,
            change,
        });
        return json(saved, 201);
    } catch (error) {
        if (missingTable(error)) return json({ error: 'The change log table is not in the database yet.' }, 409);
        return json({ error: 'Unable to save the change.' }, 500);
    }
}
