'use client';

import { useState, useEffect } from 'react';
import { Search, X, Command } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useClients } from '@/lib/hooks/use-clients';
import { clientScopeLabel } from '@/lib/agreements/logic';
import { clientIdFromPath, openVaultCommand, useVaultCommandList } from '@/components/vault/vault-commands';
import { CommandPaletteResults } from '@/components/dashboard/CommandPaletteResults';

interface GlobalSearchProps {
    isOpen: boolean;
    onClose: () => void;
}

export function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
    const [query, setQuery] = useState('');
    const router = useRouter();
    const { clients } = useClients({ statuses: ['Active'] });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const results = query.length > 1
        ? clients.filter(c =>
            c.clientName.toLowerCase().includes(query.toLowerCase()) ||
            c.accountManager.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 5)
        : [];

    const handleSelect = (clientId: string) => {
        router.push(`/workspace/${clientId}`);
        onClose();
        setQuery('');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] bg-background/80 backdrop-blur-sm p-4">
            <div
                className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="relative flex items-center p-4 border-b border-border">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    <input
                        autoFocus
                        type="text"
                        placeholder="Search clients... (Cmd+K)"
                        className="flex-1 bg-transparent border-none focus:ring-0 text-lg px-4"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono">
                            <Command className="h-3 w-3" />
                            <span>K</span>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-muted rounded-md text-muted-foreground transition-colors"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-2">
                    <SearchResults
                        query={query}
                        clients={results.map(client => ({
                            id: client.id,
                            name: client.clientName,
                            detail: `${client.accountManager} · T${client.tier} · ${clientScopeLabel(client)}`,
                        }))}
                        onSelectClient={handleSelect}
                        onClose={() => { onClose(); setQuery(''); }}
                    />
                </div>

                <div className="p-3 border-t border-border bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><span className="bg-background px-1 rounded border border-border">↑↓</span> to navigate</span>
                        <span className="flex items-center gap-1"><span className="bg-background px-1 rounded border border-border">Enter</span> to select</span>
                    </div>
                    <span>SEO OPS</span>
                </div>
            </div>
        </div>
    );
}

function SearchResults({
    query,
    clients,
    onSelectClient,
    onClose,
}: {
    query: string;
    clients: { id: string; name: string; detail: string }[];
    onSelectClient: (id: string) => void;
    onClose: () => void;
}) {
    const router = useRouter();
    const pathname = usePathname() ?? '';
    const vault = useVaultCommandList(query);
    return (
        <CommandPaletteResults
            query={query}
            clients={clients}
            vault={vault.commands.map(command => ({ id: command.id, label: command.label }))}
            vaultPending={!vault.ready}
            onSelectClient={onSelectClient}
            onSelectVault={(id) => {
                const command = vault.commands.find(item => item.id === id);
                if (!command) return;
                openVaultCommand(command, pathname, clientIdFromPath(pathname), href => router.push(href));
                onClose();
            }}
        />
    );
}
