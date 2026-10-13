import { canAdministerVault, canProposeVault, type VaultRole } from './permissions.ts';

export interface VaultCommand {
    id: string;
    label: string;
    href: string;
    keywords: string;
}

export function vaultCommands(input: {
    enabled: boolean | null;
    clientId: string | null;
    role: VaultRole | null;
}): VaultCommand[] {
    if (input.enabled !== true || !input.clientId || !input.role) return [];
    const base = `/workspace/${input.clientId}?tab=vault`;
    const items: VaultCommand[] = [
        { id: 'open-vault', label: 'Open Context Vault', href: base, keywords: 'vault context decisions rules' },
    ];
    if (canAdministerVault(input.role)) {
        items.push(
            { id: 'save-vault', label: 'Save to vault', href: `${base}&compose=1`, keywords: 'vault save create decision rule' },
            { id: 'vault-inbox', label: 'Review vault proposals', href: `${base}&inbox=1`, keywords: 'vault inbox proposals review' },
        );
    } else if (canProposeVault(input.role)) {
        items.push({ id: 'propose-vault', label: 'Propose to vault', href: `${base}&compose=1`, keywords: 'vault propose suggestion' });
    }
    return items;
}
