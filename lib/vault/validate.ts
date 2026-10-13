import {
    VAULT_COMPOSER_SOURCE_KINDS,
    VAULT_ENTRY_TYPES,
    VAULT_ENFORCEMENTS,
    VAULT_RULE_KINDS,
    VAULT_SOURCE_KINDS,
    type VaultEntryInput,
    type VaultEntryType,
    type VaultSourceKind,
} from './types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9_]{1,40}$/;

function trimmed(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function validDate(value: string): boolean {
    if (!DATE.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateVaultInput(input: VaultEntryInput, options?: { allowMemberProposal?: boolean }): string | null {
    if (!VAULT_ENTRY_TYPES.includes(input.entryType)) return 'Vault entry type is invalid';
    const title = trimmed(input.title);
    if (title.length < 1 || title.length > 180) return 'Title must be between 1 and 180 characters';
    const body = trimmed(input.body);
    if (body.length < 1 || body.length > 8000) return 'Body must be between 1 and 8000 characters';

    if (input.entryType === 'rule') {
        if (!input.ruleKind || !VAULT_RULE_KINDS.includes(input.ruleKind)) return 'Rule kind is invalid';
        if (!input.enforcement || !VAULT_ENFORCEMENTS.includes(input.enforcement)) return 'Rule enforcement must be block or warn';
        if (input.ruleDetails != null && (typeof input.ruleDetails !== 'object' || Array.isArray(input.ruleDetails))) {
            return 'Rule details must be an object';
        }
    } else if (input.ruleKind || input.enforcement) {
        return 'Only rules record enforcement';
    }

    if (input.entryType === 'contact') {
        const name = trimmed(input.contactDetails?.name);
        if (name.length < 1 || name.length > 120) return 'Contact name is required';
    }

    const purposes = input.appliesTo ?? [];
    if (purposes.length > 12) return 'Applies-to is too long';
    if (purposes.some(purpose => !SLUG.test(purpose))) return 'Applies-to values must be short slugs';

    if (!validDate(input.effectiveOn ?? '')) return input.effectiveOn ? 'Effective date is invalid' : 'Effective date is required';
    if (input.reviewOn) {
        if (!validDate(input.reviewOn)) return 'Review date is invalid';
        if (input.reviewOn < input.effectiveOn) return 'Review date must be on or after the effective date';
    }

    const quote = input.quote ?? '';
    if (quote !== '') {
        if (quote.trim().length < 1 || quote.length > 8000) return 'Quote must be between 1 and 8000 characters';
        const kinds = options?.allowMemberProposal ? VAULT_SOURCE_KINDS : VAULT_COMPOSER_SOURCE_KINDS;
        if (!input.sourceKind || !(kinds as readonly string[]).includes(input.sourceKind)) return input.sourceKind ? 'Source kind is invalid' : 'A quote needs a source kind';
        if (input.sourceRef && input.sourceRef.length > 500) return 'Source reference is too long';
    }
    return null;
}

export function emptyVaultInput(entryType: VaultEntryType = 'decision'): VaultEntryInput {
    const today = new Date();
    const effectiveOn = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return {
        entryType,
        title: '',
        body: '',
        appliesTo: [],
        effectiveOn,
        pinned: false,
        quote: '',
        sourceKind: null,
        sourceRef: '',
    };
}

export function isVaultSourceKind(value: string): value is VaultSourceKind {
    return (VAULT_SOURCE_KINDS as readonly string[]).includes(value);
}
