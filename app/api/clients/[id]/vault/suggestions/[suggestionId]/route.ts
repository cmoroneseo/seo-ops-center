import { NextRequest, NextResponse } from 'next/server';
import { authorizeVaultRequest, assertVaultAdmin, callVault } from '@/lib/vault/server';
import { canProposeVault } from '@/lib/vault/permissions';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; suggestionId: string }> }) {
    const { id, suggestionId } = await params;
    const access = await authorizeVaultRequest(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    const body = await request.json().catch(() => null);
    const action = body && typeof body === 'object' ? (body as { action?: string }).action : null;
    const reason = body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string'
        ? (body as { reason: string }).reason
        : null;
    if (action === 'accept' || action === 'dismiss') {
        const admin = await assertVaultAdmin(access.organizationId);
        if (!admin.ok) return json({ error: admin.error }, admin.status);
        const fn = action === 'accept' ? 'accept_client_vault_suggestion' : 'dismiss_client_vault_suggestion';
        const args = action === 'accept'
            ? { p_client: id, p_suggestion: suggestionId }
            : { p_client: id, p_suggestion: suggestionId, p_reason: reason };
        const result = await callVault<string>(fn, args);
        if (!result.ok) return json({ error: result.error }, result.status);
        return json({ id: result.data });
    }
    if (action === 'withdraw') {
        if (!canProposeVault(access.role)) return json({ error: 'Forbidden' }, 403);
        const result = await callVault<string>('withdraw_client_vault_suggestion', { p_client: id, p_suggestion: suggestionId });
        if (!result.ok) return json({ error: result.error }, result.status);
        return json({ id: result.data });
    }
    return json({ error: 'Vault suggestion is invalid' }, 400);
}
