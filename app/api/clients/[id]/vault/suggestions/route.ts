import { NextRequest, NextResponse } from 'next/server';
import { authorizeVaultRequest, assertVaultAdmin, callVault } from '@/lib/vault/server';
import { canProposeVault } from '@/lib/vault/permissions';
import { rowsToVaultSuggestions } from '@/lib/supabase/vault';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await authorizeVaultRequest(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    const scope = request.nextUrl.searchParams.get('scope') === 'inbox' ? 'inbox' : 'mine';
    if (scope === 'inbox') {
        const admin = await assertVaultAdmin(access.organizationId);
        if (!admin.ok) return json({ error: admin.error }, admin.status);
    } else if (!canProposeVault(access.role)) {
        return json({ suggestions: [] });
    }
    const result = await callVault('list_client_vault_suggestions', { p_client: id, p_scope: scope });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ suggestions: rowsToVaultSuggestions(result.data) });
}
