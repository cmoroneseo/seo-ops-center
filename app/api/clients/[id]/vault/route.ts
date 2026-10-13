import { NextRequest, NextResponse } from 'next/server';
import { authorizeVaultRequest, assertVaultAdmin, callVault } from '@/lib/vault/server';
import { canProposeVault } from '@/lib/vault/permissions';
import { validateVaultInput } from '@/lib/vault/validate';
import type { VaultEntryInput, VaultEntryType, VaultRuleKind, VaultSourceKind } from '@/lib/vault/types';
import { rowToVaultCounts, rowsToVaultEntries } from '@/lib/supabase/vault';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status });
}

function inputFrom(body: Record<string, unknown>): VaultEntryInput {
    return {
        entryType: body.entryType as VaultEntryType,
        title: typeof body.title === 'string' ? body.title : '',
        body: typeof body.body === 'string' ? body.body : '',
        ruleKind: (body.ruleKind ?? null) as VaultRuleKind | null,
        enforcement: body.enforcement === 'block' || body.enforcement === 'warn' ? body.enforcement : null,
        ruleDetails: body.ruleDetails && typeof body.ruleDetails === 'object' ? body.ruleDetails as VaultEntryInput['ruleDetails'] : null,
        contactDetails: body.contactDetails && typeof body.contactDetails === 'object' ? body.contactDetails as VaultEntryInput['contactDetails'] : null,
        appliesTo: Array.isArray(body.appliesTo) ? body.appliesTo.filter((item): item is string => typeof item === 'string') : [],
        effectiveOn: typeof body.effectiveOn === 'string' ? body.effectiveOn : '',
        reviewOn: typeof body.reviewOn === 'string' ? body.reviewOn : null,
        pinned: body.pinned === true,
        quote: typeof body.quote === 'string' ? body.quote : null,
        sourceKind: (typeof body.sourceKind === 'string' ? body.sourceKind : null) as VaultSourceKind | null,
        sourceRef: typeof body.sourceRef === 'string' ? body.sourceRef : null,
    };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await authorizeVaultRequest(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    const url = request.nextUrl;
    if (url.searchParams.get('view') === 'counts') {
        const counts = await callVault('client_vault_counts', { p_client: id });
        if (!counts.ok) return json({ error: counts.error }, counts.status);
        return json({ counts: rowToVaultCounts(counts.data) });
    }
    const pinned = url.searchParams.get('pinned');
    const [entries, counts] = await Promise.all([
        callVault('list_client_vault_entries', {
            p_client: id,
            p_query: url.searchParams.get('q'),
            p_type: url.searchParams.get('type'),
            p_status: url.searchParams.get('status') ?? 'active',
            p_pinned: pinned === 'true' ? true : pinned === 'false' ? false : null,
            p_rule_kind: url.searchParams.get('ruleKind'),
            p_purpose: url.searchParams.get('purpose'),
            p_limit: 50,
        }),
        callVault('client_vault_counts', { p_client: id }),
    ]);
    if (!entries.ok) return json({ error: entries.error }, entries.status);
    if (!counts.ok) return json({ error: counts.error }, counts.status);
    return json({ entries: rowsToVaultEntries(entries.data), counts: rowToVaultCounts(counts.data) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await authorizeVaultRequest(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Vault entry is invalid' }, 400);
    const mode = (body as { mode?: string }).mode;
    const input = inputFrom(body as Record<string, unknown>);
    const invalid = validateVaultInput(input);
    if (invalid) return json({ error: invalid }, 400);
    if (mode === 'create') {
        const admin = await assertVaultAdmin(access.organizationId);
        if (!admin.ok) return json({ error: admin.error }, admin.status);
        const created = await callVault<string>('create_client_vault_entry', { p_client: id, p_input: input });
        if (!created.ok) return json({ error: created.error }, created.status);
        return json({ id: created.data }, 201);
    }
    if (mode === 'propose') {
        if (!canProposeVault(access.role)) return json({ error: 'Forbidden' }, 403);
        const proposed = await callVault<string>('propose_client_vault_entry', { p_client: id, p_input: input });
        if (!proposed.ok) return json({ error: proposed.error }, proposed.status);
        return json({ id: proposed.data }, 201);
    }
    return json({ error: 'Vault entry is invalid' }, 400);
}
