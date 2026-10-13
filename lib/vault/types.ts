export const VAULT_ENTRY_TYPES = ['decision', 'rule', 'approval', 'contact', 'precedent'] as const;
export type VaultEntryType = (typeof VAULT_ENTRY_TYPES)[number];

export const VAULT_STATUSES = ['active', 'superseded', 'archived'] as const;
export type VaultStatus = (typeof VAULT_STATUSES)[number];

export const VAULT_RULE_KINDS = ['content', 'linking', 'technical', 'brand', 'reporting', 'access', 'other'] as const;
export type VaultRuleKind = (typeof VAULT_RULE_KINDS)[number];

export const VAULT_ENFORCEMENTS = ['block', 'warn'] as const;
export type VaultEnforcement = (typeof VAULT_ENFORCEMENTS)[number];

export const VAULT_SOURCE_KINDS = ['email', 'meeting', 'document', 'call', 'chat', 'member_proposal', 'other'] as const;
export type VaultSourceKind = (typeof VAULT_SOURCE_KINDS)[number];

export const VAULT_COMPOSER_SOURCE_KINDS = ['email', 'meeting', 'document', 'call', 'chat', 'other'] as const;

export const VAULT_SUGGESTION_STATUSES = ['pending', 'accepted', 'dismissed', 'withdrawn'] as const;
export type VaultSuggestionStatus = (typeof VAULT_SUGGESTION_STATUSES)[number];

export const VAULT_PURPOSES = [
    { id: 'content', label: 'Content' },
    { id: 'outreach', label: 'Outreach' },
    { id: 'reporting', label: 'Reporting' },
    { id: 'technical_seo', label: 'Technical SEO' },
    { id: 'local', label: 'Local' },
    { id: 'client_communication', label: 'Client communication' },
] as const;

export const VAULT_TYPE_LABEL: Record<VaultEntryType, string> = {
    decision: 'Decision',
    rule: 'Rule',
    approval: 'Approval',
    contact: 'Contact',
    precedent: 'Precedent',
};

export const VAULT_RULE_KIND_LABEL: Record<VaultRuleKind, string> = {
    content: 'Content',
    linking: 'Linking',
    technical: 'Technical',
    brand: 'Brand',
    reporting: 'Reporting',
    access: 'Access',
    other: 'Other',
};

export const VAULT_SOURCE_LABEL: Record<VaultSourceKind, string> = {
    email: 'Email',
    meeting: 'Meeting',
    document: 'Document',
    call: 'Call',
    chat: 'Chat',
    member_proposal: 'Member proposal',
    other: 'Other',
};

export interface VaultContactDetails {
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    channel?: string;
}

export interface VaultRuleDetails {
    statement?: string;
    exceptions?: string;
}

export interface VaultEntryInput {
    entryType: VaultEntryType;
    title: string;
    body: string;
    ruleKind?: VaultRuleKind | null;
    enforcement?: VaultEnforcement | null;
    ruleDetails?: VaultRuleDetails | null;
    contactDetails?: VaultContactDetails | null;
    appliesTo?: string[];
    effectiveOn: string;
    reviewOn?: string | null;
    pinned?: boolean;
    quote?: string | null;
    sourceKind?: VaultSourceKind | null;
    sourceRef?: string | null;
}

export interface VaultEntry {
    id: string;
    organizationId: string;
    clientId: string;
    lineageId: string;
    versionNo: number;
    supersedesId: string | null;
    entryType: VaultEntryType;
    status: VaultStatus;
    title: string;
    body: string;
    ruleKind: VaultRuleKind | null;
    enforcement: VaultEnforcement | null;
    ruleDetails: VaultRuleDetails | null;
    contactDetails: VaultContactDetails | null;
    appliesTo: string[];
    effectiveOn: string;
    reviewOn: string | null;
    pinned: boolean;
    authorId: string | null;
    authorName: string | null;
    proposedBy: string | null;
    proposedByName: string | null;
    suggestionId: string | null;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    supersededAt: string | null;
}

export interface VaultSource {
    id: string;
    quote: string;
    sourceKind: VaultSourceKind;
    sourceRef: string | null;
    createdAt: string;
}

export interface VaultEvidence {
    id: string;
    kind: 'gsc_before' | 'gsc_after';
    label: string | null;
    payload: Record<string, unknown>;
    capturedOn: string | null;
    createdAt: string;
}

export interface VaultEntryDetail {
    entry: VaultEntry;
    sources: VaultSource[];
    history: VaultEntry[];
    evidence: VaultEvidence[];
}

export interface VaultSuggestion {
    id: string;
    organizationId: string;
    clientId: string;
    status: VaultSuggestionStatus;
    payload: VaultEntryInput;
    dismissReason: string | null;
    proposedBy: string;
    proposedByName: string | null;
    resolvedBy: string | null;
    resolvedByName: string | null;
    resolvedEntryId: string | null;
    createdAt: string;
    resolvedAt: string | null;
}

export interface VaultCounts {
    active: number | null;
    inbox: number | null;
}

export interface VaultListFilters {
    query?: string;
    type?: VaultEntryType | null;
    status?: VaultStatus | 'all';
    pinned?: boolean | null;
    ruleKind?: VaultRuleKind | null;
    purpose?: string | null;
}
