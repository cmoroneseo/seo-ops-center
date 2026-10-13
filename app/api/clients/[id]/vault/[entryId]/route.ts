import { NextRequest, NextResponse } from 'next/server';
import { authorizeVaultRequest, assertVaultAdmin, callVault } from '@/lib/vault/server';
import { rowToVaultDetail } from '@/lib/supabase/vault';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
    const { id, entryId } = await params;
    const access = await authorizeVaultRequest(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    const result = await callVault('get_client_vault_entry', { p_client: id, p_entry: entryId });
    if (!result.ok) return json({ error: result.error }, result.status);
    const detail = rowToVaultDetail(result.data);
    if (!detail) return json({ error: 'Not found' }, 404);
    return json(detail);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
    const { id, entryId } = await params;
    const access = await authorizeVaultRequest(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    const admin = await assertVaultAdmin(access.organizationId);
    if (!admin.ok) return json({ error: admin.error }, admin.status);
    const body = await request.json().catch(() => null);
    const op = body && typeof body === 'object' ? (body as { op?: string }).op : null;
    if (op === 'archive') {
        const result = await callVault<string>('archive_client_vault_entry', { p_client: id, p_entry: entryId });
        if (!result.ok) return json({ error: result.error }, result.status);
        return json({ id: result.data });
    }
    if (op === 'pin') {
        const patch: Record<string, unknown> = {};
        if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
        if ('reviewOn' in body) patch.reviewOn = body.reviewOn;
        const result = await callVault<string>('set_client_vault_pin_review', { p_client: id, p_entry: entryId, p_patch: patch });
        if (!result.ok) return json({ error: result.error }, result.status);
        return json({ id: result.data });
    }
    return json({ error: 'Vault entry is invalid' }, 400);
}
