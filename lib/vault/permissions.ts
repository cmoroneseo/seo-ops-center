export type VaultRole = 'owner' | 'admin' | 'member' | 'viewer';

export function canReadVault(role: VaultRole): boolean {
    return role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer';
}

export function canAdministerVault(role: VaultRole): boolean {
    return role === 'owner' || role === 'admin';
}

export function canProposeVault(role: VaultRole): boolean {
    return role === 'owner' || role === 'admin' || role === 'member';
}

export function vaultWriteLabel(role: VaultRole): 'Save to vault' | 'Propose to vault' | null {
    if (canAdministerVault(role)) return 'Save to vault';
    if (canProposeVault(role)) return 'Propose to vault';
    return null;
}

/** A count that has not loaded stays an em dash. Zero is only for a confirmed empty result. */
export function formatVaultCount(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return '—';
    return String(value);
}

const VAULT_EMPTY_TITLE = 'Nothing saved for this client yet';

/** Viewers wait on the department. Admins and members get the action their role can take. */
export function vaultEmptyState(role: VaultRole): { title: string; body: string; action: 'Save to vault' | 'Propose to vault' | null } {
    if (canAdministerVault(role)) {
        return {
            title: VAULT_EMPTY_TITLE,
            body: 'Save to vault to record a decision, rule, approval, contact, or precedent for this client.',
            action: 'Save to vault',
        };
    }
    if (canProposeVault(role)) {
        return {
            title: VAULT_EMPTY_TITLE,
            body: 'Propose to vault when a decision or rule should be saved. An admin on the SEO team reviews it first.',
            action: 'Propose to vault',
        };
    }
    return {
        title: VAULT_EMPTY_TITLE,
        body: 'Decisions, rules, approvals, contacts, and precedents live here once the SEO department saves them.',
        action: null,
    };
}
