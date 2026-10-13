import { NextRequest, NextResponse } from 'next/server';
import { authorizeVaultRequest, assertVaultAdmin, callVault } from '@/lib/vault/server';
import { validateVaultInput } from '@/lib/vault/validate';
import type { VaultEntryInput, VaultEntryType, VaultRuleKind, VaultSourceKind } from '@/lib/vault/types';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
    const { id, entryId } = await params;
    const access = await authorizeVaultRequest(id);
    if (!access.ok) return json({ error: access.error }, access.status);
    const admin = await assertVaultAdmin(access.organizationId);
    if (!admin.ok) return json({ error: admin.error }, admin.status);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'Vault entry is invalid' }, 400);
    const record = body as Record<string, unknown>;
    const input: VaultEntryInput = {
        entryType: record.entryType as VaultEntryType,
        title: typeof record.title === 'string' ? record.title : '',
        body: typeof record.body === 'string' ? record.body : '',
        ruleKind: (record.ruleKind ?? null) as VaultRuleKind | null,
        enforcement: record.enforcement === 'block' || record.enforcement === 'warn' ? record.enforcement : null,
        ruleDetails: record.ruleDetails && typeof record.ruleDetails === 'object' ? record.ruleDetails as VaultEntryInput['ruleDetails'] : null,
        contactDetails: record.contactDetails && typeof record.contactDetails === 'object' ? record.contactDetails as VaultEntryInput['contactDetails'] : null,
        appliesTo: Array.isArray(record.appliesTo) ? record.appliesTo.filter((item): item is string => typeof item === 'string') : [],
        effectiveOn: typeof record.effectiveOn === 'string' ? record.effectiveOn : '',
        reviewOn: typeof record.reviewOn === 'string' ? record.reviewOn : null,
        pinned: record.pinned === true,
        quote: typeof record.quote === 'string' ? record.quote : null,
        sourceKind: (typeof record.sourceKind === 'string' ? record.sourceKind : null) as VaultSourceKind | null,
        sourceRef: typeof record.sourceRef === 'string' ? record.sourceRef : null,
    };
    const invalid = validateVaultInput(input);
    if (invalid) return json({ error: invalid }, 400);
    const result = await callVault<string>('supersede_client_vault_entry', { p_client: id, p_entry: entryId, p_input: input });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ id: result.data }, 201);
}
