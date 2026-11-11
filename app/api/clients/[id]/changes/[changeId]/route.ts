import { NextResponse } from 'next/server';

import { deleteChange, getChange, missingTable } from '@/lib/change-log/store';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; changeId: string }> }) {
    const { id, changeId } = await params;
    const access = await requireClientOrgMember(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    try {
        const result = await getChange(access.organizationId, access.clientId, changeId);
        if (result.setup === 'missing') return json({ setup: 'missing' });
        if (!result.change || !result.impact) return json({ error: 'Change not found.' }, 404);
        return json({
            setup: 'ready',
            change: result.change,
            impact: result.impact,
            confounders: result.confounders,
            baselineNote: result.baselineNote,
        });
    } catch (error) {
        if (missingTable(error)) return json({ setup: 'missing' });
        return json({ error: 'Unable to load this change.' }, 500);
    }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; changeId: string }> }) {
    const { id, changeId } = await params;
    const access = await requireClientOrgMember(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    if (access.role === 'viewer') return json({ error: 'You can view the change log, not edit it.' }, 403);
    try {
        const removed = await deleteChange(access.organizationId, access.clientId, changeId);
        if (!removed) return json({ error: 'Change not found.' }, 404);
        return json({ ok: true });
    } catch (error) {
        if (missingTable(error)) return json({ error: 'The change log table is not in the database yet.' }, 409);
        return json({ error: 'Unable to remove the change.' }, 500);
    }
}
