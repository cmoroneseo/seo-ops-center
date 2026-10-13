import type {
    VaultContactDetails,
    VaultCounts,
    VaultEntry,
    VaultEntryDetail,
    VaultEntryInput,
    VaultEntryType,
    VaultEvidence,
    VaultListFilters,
    VaultRuleDetails,
    VaultRuleKind,
    VaultSource,
    VaultSourceKind,
    VaultSuggestion,
    VaultSuggestionStatus,
} from '@/lib/vault/types';
import { VAULT_ENTRY_TYPES, VAULT_ENFORCEMENTS, VAULT_RULE_KINDS, VAULT_SOURCE_KINDS, VAULT_STATUSES, VAULT_SUGGESTION_STATUSES } from '@/lib/vault/types';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function contactDetails(value: unknown): VaultContactDetails | null {
    const record = asRecord(value);
    const name = asString(record?.name);
    if (!record || !name) return null;
    return {
        name,
        role: asString(record.role) ?? undefined,
        email: asString(record.email) ?? undefined,
        phone: asString(record.phone) ?? undefined,
        channel: asString(record.channel) ?? undefined,
    };
}

function ruleDetails(value: unknown): VaultRuleDetails | null {
    const record = asRecord(value);
    if (!record) return null;
    return {
        statement: asString(record.statement) ?? undefined,
        exceptions: asString(record.exceptions) ?? undefined,
    };
}

export function rowToVaultEntry(row: Record<string, unknown>): VaultEntry | null {
    const id = asString(row.id);
    const entryType = oneOf(row.entry_type, VAULT_ENTRY_TYPES);
    const status = oneOf(row.status, VAULT_STATUSES);
    const title = asString(row.title);
    const body = typeof row.body === 'string' ? row.body : null;
    if (!id || !entryType || !status || !title || body == null) return null;
    return {
        id,
        organizationId: asString(row.organization_id) ?? '',
        clientId: asString(row.client_id) ?? '',
        lineageId: asString(row.lineage_id) ?? id,
        versionNo: typeof row.version_no === 'number' ? row.version_no : Number(row.version_no) || 1,
        supersedesId: asString(row.supersedes_id),
        entryType,
        status,
        title,
        body,
        ruleKind: oneOf(row.rule_kind, VAULT_RULE_KINDS),
        enforcement: oneOf(row.enforcement, VAULT_ENFORCEMENTS),
        ruleDetails: ruleDetails(row.rule_details),
        contactDetails: contactDetails(row.contact_details),
        appliesTo: asStringList(row.applies_to),
        effectiveOn: asString(row.effective_on) ?? '',
        reviewOn: asString(row.review_on),
        pinned: row.pinned === true,
        authorId: asString(row.author_id),
        authorName: asString(row.author_name),
        proposedBy: asString(row.proposed_by),
        proposedByName: asString(row.proposed_by_name),
        suggestionId: asString(row.suggestion_id),
        createdAt: asString(row.created_at) ?? '',
        updatedAt: asString(row.updated_at) ?? '',
        archivedAt: asString(row.archived_at),
        supersededAt: asString(row.superseded_at),
    };
}

export function payloadToInput(payload: Record<string, unknown>): VaultEntryInput {
    const contact = contactDetails(payload.contact_details);
    return {
        entryType: oneOf(payload.entry_type, VAULT_ENTRY_TYPES) ?? 'decision',
        title: asString(payload.title) ?? '',
        body: typeof payload.body === 'string' ? payload.body : '',
        ruleKind: oneOf(payload.rule_kind, VAULT_RULE_KINDS),
        enforcement: oneOf(payload.enforcement, VAULT_ENFORCEMENTS),
        ruleDetails: ruleDetails(payload.rule_details),
        contactDetails: contact,
        appliesTo: asStringList(payload.applies_to),
        effectiveOn: asString(payload.effective_on) ?? '',
        reviewOn: asString(payload.review_on),
        pinned: payload.pinned === true,
        quote: typeof payload.quote === 'string' ? payload.quote : null,
        sourceKind: oneOf(payload.source_kind, VAULT_SOURCE_KINDS),
        sourceRef: asString(payload.source_ref),
    };
}

export function rowToVaultSource(row: Record<string, unknown>): VaultSource | null {
    const id = asString(row.id);
    const quote = typeof row.quote === 'string' ? row.quote : null;
    const sourceKind = oneOf(row.source_kind, VAULT_SOURCE_KINDS);
    if (!id || quote == null || !sourceKind) return null;
    return { id, quote, sourceKind, sourceRef: asString(row.source_ref), createdAt: asString(row.created_at) ?? '' };
}

export function rowToVaultEvidence(row: Record<string, unknown>): VaultEvidence | null {
    const id = asString(row.id);
    const kind = row.kind === 'gsc_before' || row.kind === 'gsc_after' ? row.kind : null;
    if (!id || !kind) return null;
    return {
        id,
        kind,
        label: asString(row.label),
        payload: asRecord(row.payload) ?? {},
        capturedOn: asString(row.captured_on),
        createdAt: asString(row.created_at) ?? '',
    };
}

export function rowToVaultDetail(value: unknown): VaultEntryDetail | null {
    const record = asRecord(value);
    const entry = record ? rowToVaultEntry(asRecord(record.entry) ?? {}) : null;
    if (!record || !entry) return null;
    const list = (key: string, map: (row: Record<string, unknown>) => VaultSource | VaultEvidence | VaultEntry | null) =>
        Array.isArray(record[key]) ? record[key].flatMap(item => {
            const row = asRecord(item);
            const mapped = row ? map(row) : null;
            return mapped ? [mapped] : [];
        }) : [];
    return {
        entry,
        sources: list('sources', rowToVaultSource) as VaultSource[],
        history: list('history', rowToVaultEntry) as VaultEntry[],
        evidence: list('evidence', rowToVaultEvidence) as VaultEvidence[],
    };
}

export function rowToVaultSuggestion(row: Record<string, unknown>): VaultSuggestion | null {
    const id = asString(row.id);
    const status = oneOf(row.status, VAULT_SUGGESTION_STATUSES);
    const payload = asRecord(row.payload);
    const proposedBy = asString(row.proposed_by);
    if (!id || !status || !payload || !proposedBy) return null;
    return {
        id,
        organizationId: asString(row.organization_id) ?? '',
        clientId: asString(row.client_id) ?? '',
        status: status as VaultSuggestionStatus,
        payload: payloadToInput(payload),
        dismissReason: asString(row.dismiss_reason),
        proposedBy,
        proposedByName: asString(row.proposed_by_name),
        resolvedBy: asString(row.resolved_by),
        resolvedByName: asString(row.resolved_by_name),
        resolvedEntryId: asString(row.resolved_entry_id),
        createdAt: asString(row.created_at) ?? '',
        resolvedAt: asString(row.resolved_at),
    };
}

export function rowsToVaultEntries(value: unknown): VaultEntry[] {
    return Array.isArray(value) ? value.flatMap(item => {
        const row = asRecord(item);
        const entry = row ? rowToVaultEntry(row) : null;
        return entry ? [entry] : [];
    }) : [];
}

export function rowsToVaultSuggestions(value: unknown): VaultSuggestion[] {
    return Array.isArray(value) ? value.flatMap(item => {
        const row = asRecord(item);
        const suggestion = row ? rowToVaultSuggestion(row) : null;
        return suggestion ? [suggestion] : [];
    }) : [];
}

export function rowToVaultCounts(value: unknown): VaultCounts {
    const record = asRecord(value);
    const active = typeof record?.active === 'number' && Number.isInteger(record.active) ? record.active : null;
    const inbox = record?.inbox == null ? null : (typeof record.inbox === 'number' && Number.isInteger(record.inbox) ? record.inbox : null);
    return { active, inbox };
}

export class VaultRequestError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = 'VaultRequestError';
        this.status = status;
    }
}

async function vaultFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'Vault request failed';
        throw new VaultRequestError(message, response.status);
    }
    return body as T;
}

function listQuery(filters: VaultListFilters = {}): string {
    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.type) params.set('type', filters.type);
    if (filters.status) params.set('status', filters.status);
    if (filters.pinned != null) params.set('pinned', String(filters.pinned));
    if (filters.ruleKind) params.set('ruleKind', filters.ruleKind);
    if (filters.purpose) params.set('purpose', filters.purpose);
    const query = params.toString();
    return query ? `?${query}` : '';
}

export function getVaultList(clientId: string, filters?: VaultListFilters) {
    return vaultFetch<{ entries: VaultEntry[]; counts: VaultCounts }>(`/api/clients/${clientId}/vault${listQuery(filters)}`);
}

export function getVaultCounts(clientId: string) {
    return vaultFetch<{ counts: VaultCounts }>(`/api/clients/${clientId}/vault?view=counts`);
}

export function getVaultEntry(clientId: string, entryId: string) {
    return vaultFetch<VaultEntryDetail>(`/api/clients/${clientId}/vault/${entryId}`);
}

export function saveVaultEntry(clientId: string, mode: 'create' | 'propose', input: VaultEntryInput) {
    return vaultFetch<{ id: string }>(`/api/clients/${clientId}/vault`, {
        method: 'POST',
        body: JSON.stringify({ mode, ...input }),
    });
}

export function supersedeVaultEntry(clientId: string, entryId: string, input: VaultEntryInput) {
    return vaultFetch<{ id: string }>(`/api/clients/${clientId}/vault/${entryId}/supersede`, {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export function archiveVaultEntry(clientId: string, entryId: string) {
    return vaultFetch<{ id: string }>(`/api/clients/${clientId}/vault/${entryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ op: 'archive' }),
    });
}

export function updateVaultPin(clientId: string, entryId: string, patch: { pinned?: boolean; reviewOn?: string | null }) {
    return vaultFetch<{ id: string }>(`/api/clients/${clientId}/vault/${entryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ op: 'pin', ...patch }),
    });
}

export function getVaultSuggestions(clientId: string, scope: 'inbox' | 'mine') {
    return vaultFetch<{ suggestions: VaultSuggestion[] }>(`/api/clients/${clientId}/vault/suggestions?scope=${scope}`);
}

export function resolveVaultSuggestion(clientId: string, suggestionId: string, action: 'accept' | 'dismiss' | 'withdraw', reason?: string) {
    return vaultFetch<{ id: string }>(`/api/clients/${clientId}/vault/suggestions/${suggestionId}`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
    });
}

export type { VaultEntryType, VaultRuleKind, VaultSourceKind };
