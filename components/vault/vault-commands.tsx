'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Archive } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { vaultCommands } from '@/lib/vault/commands';
import { useVaultEnabled } from './use-vault-enabled';

const CLIENT_PATH = /^\/workspace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function VaultCommandItems({ query, onClose }: { query: string; onClose: () => void }) {
    const pathname = usePathname() ?? '';
    const router = useRouter();
    const { organization } = useOrganization();
    const { role, isLoading } = useCurrentMember();
    const enabled = useVaultEnabled(organization?.id);
    const clientId = pathname.match(CLIENT_PATH)?.[1] ?? null;
    const commands = vaultCommands({
        enabled,
        clientId,
        role: isLoading ? null : role,
    }).filter(command => {
        if (query.trim().length < 2) return true;
        const haystack = `${command.label} ${command.keywords}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
    });
    if (commands.length === 0) return null;

    return (
        <div>
            <h3 className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Context Vault</h3>
            <div className="space-y-1">
                {commands.map(command => (
                    <button
                        key={command.id}
                        type="button"
                        onClick={() => {
                            const here = clientId != null && pathname.toLowerCase().includes(`/workspace/${clientId.toLowerCase()}`);
                            if (here) {
                                window.history.pushState(null, '', command.href);
                                window.dispatchEvent(new Event('vault:navigate'));
                            } else {
                                router.push(command.href);
                            }
                            onClose();
                        }}
                        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-primary/10"
                    >
                        <span className="flex h-8 w-8 items-center justify-center rounded bg-primary/15 text-primary">
                            <Archive className="h-4 w-4" />
                        </span>
                        <span className="text-sm font-medium">{command.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
