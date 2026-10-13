'use client';

import { usePathname } from 'next/navigation';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { matchingVaultCommands, vaultCommands, type VaultCommand } from '@/lib/vault/commands';
import { useVaultEnabled } from './use-vault-enabled';

const CLIENT_PATH = /^\/workspace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function clientIdFromPath(pathname: string): string | null {
    return pathname.match(CLIENT_PATH)?.[1] ?? null;
}

export function useVaultCommandList(query: string): { commands: VaultCommand[]; ready: boolean } {
    const pathname = usePathname() ?? '';
    const { organization } = useOrganization();
    const { role, isLoading } = useCurrentMember();
    const enabled = useVaultEnabled(organization?.id);
    const commands = matchingVaultCommands(vaultCommands({
        enabled,
        clientId: clientIdFromPath(pathname),
        role: isLoading ? null : role,
    }), query);
    return { commands, ready: enabled !== null && !isLoading };
}

export function openVaultCommand(
    command: VaultCommand,
    pathname: string,
    clientId: string | null,
    push: (href: string) => void,
) {
    const here = clientId != null && pathname.toLowerCase().includes(`/workspace/${clientId.toLowerCase()}`);
    if (here) {
        window.history.pushState(null, '', command.href);
        window.dispatchEvent(new Event('vault:navigate'));
        return;
    }
    push(command.href);
}
