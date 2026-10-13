'use client';

import { Briefcase, CheckSquare, FileText, Archive } from 'lucide-react';

export interface CommandPaletteClient {
    id: string;
    name: string;
    detail: string;
}

export interface CommandPaletteVaultItem {
    id: string;
    label: string;
}

/** Empty copy is for a finished search with no hits in any group. A short query is the quick-link state. */
export function commandPaletteShowsEmpty(query: string, groupSizes: number[], pendingGroups = 0): boolean {
    if (query.length <= 1 || pendingGroups > 0) return false;
    return groupSizes.every(size => size === 0);
}

export function CommandPaletteResults({
    query,
    clients,
    vault,
    vaultPending = false,
    onSelectClient,
    onSelectVault,
}: {
    query: string;
    clients: CommandPaletteClient[];
    vault: CommandPaletteVaultItem[];
    vaultPending?: boolean;
    onSelectClient: (id: string) => void;
    onSelectVault: (id: string) => void;
}) {
    const searching = query.length > 1;
    const showEmpty = commandPaletteShowsEmpty(query, [clients.length, vault.length], vaultPending ? 1 : 0);

    if (!searching) {
        return (
            <div className="space-y-4 p-4">
                <VaultGroup vault={vault} onSelectVault={onSelectVault} />
                <h3 className="text-sm font-medium mb-4">Quick Links</h3>
                <div className="grid grid-cols-2 gap-2">
                    <button className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left">
                        <CheckSquare className="h-4 w-4 text-orange-500" />
                        <span className="text-sm">My Tasks</span>
                    </button>
                    <button className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left">
                        <FileText className="h-4 w-4 text-blue-500" />
                        <span className="text-sm">Reports</span>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {clients.length > 0 && (
                <div>
                    <h3 className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Clients</h3>
                    <div className="space-y-1">
                        {clients.map(client => (
                            <button
                                key={client.id}
                                onClick={() => onSelectClient(client.id)}
                                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-primary/10 transition-colors text-left"
                            >
                                <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center text-primary">
                                    <Briefcase className="h-4 w-4" />
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <p className="font-medium text-sm truncate">{client.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{client.detail}</p>
                                </div>
                                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border text-muted-foreground">Jump to</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <VaultGroup vault={vault} onSelectVault={onSelectVault} />
            {showEmpty && (
                <div className="py-12 text-center">
                    <p className="text-muted-foreground">No matches for "{query}"</p>
                </div>
            )}
        </div>
    );
}

function VaultGroup({ vault, onSelectVault }: { vault: CommandPaletteVaultItem[]; onSelectVault: (id: string) => void }) {
    if (vault.length === 0) return null;
    return (
        <div>
            <h3 className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Context Vault</h3>
            <div className="space-y-1">
                {vault.map(command => (
                    <button
                        key={command.id}
                        type="button"
                        onClick={() => onSelectVault(command.id)}
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
