'use client';

import { useState, useEffect } from 'react';
import { Search, X, Command } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useClients } from '@/lib/hooks/use-clients';
import { clientScopeLabel } from '@/lib/hour-format';
import { clientIdFromPath, openVaultCommand, useVaultCommandList } from '@/components/vault/vault-commands';
import { CommandPaletteResults } from '@/components/dashboard/CommandPaletteResults';
import { useOrganization } from '@/components/providers/organization-provider';
import { searchCommandResults } from '@/lib/dashboard/command-palette';
import { searchOrgProjectsAndTasks } from '@/lib/supabase/global-search';

interface GlobalSearchProps {
    isOpen: boolean;
    onClose: () => void;
}

export function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
    const { clients } = useClients({ statuses: ['Active'] });
    return isOpen ? <OpenGlobalSearch onClose={onClose} clients={clients} /> : null;
}

function OpenGlobalSearch({ onClose, clients }: {
    onClose: () => void;
    clients: ReturnType<typeof useClients>['clients'];
}) {
    const [query, setQuery] = useState('');
    const router = useRouter();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const normalizedQuery = query.trim().toLowerCase();
    const results = normalizedQuery.length >= 2
        ? clients.filter(c =>
            c.clientName.toLowerCase().includes(normalizedQuery) ||
            c.accountManager.toLowerCase().includes(normalizedQuery)
        ).slice(0, 5)
        : [];

    const handleSelect = (clientId: string) => {
        router.push(`/workspace/${clientId}`);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm">
            <div
                className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="relative flex items-center p-4 border-b border-border">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    <input
                        autoFocus
                        type="text"
                        placeholder="Search or jump to…"
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
                        onClose={onClose}
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
    const { organization } = useOrganization();
    const organizationId = organization?.id;
    const trimmed = query.trim();
    const vault = useVaultCommandList(trimmed);
    const [search, setSearch] = useState<{
        organizationId: string;
        query: string;
        items: ReturnType<typeof searchCommandResults>;
    } | null>(null);

    useEffect(() => {
        setSearch(null);
        if (!organizationId || trimmed.length < 2) return;

        let stale = false;
        const timeout = window.setTimeout(async () => {
            const hits = await searchOrgProjectsAndTasks(organizationId, trimmed)
                .catch(() => ({ projects: [], tasks: [] }));
            if (!stale) setSearch({ organizationId, query: trimmed, items: searchCommandResults(hits) });
        }, 200);
        return () => {
            stale = true;
            window.clearTimeout(timeout);
        };
    }, [organizationId, trimmed]);

    const items = search?.organizationId === organizationId && search?.query === trimmed ? search.items : undefined;
    const pending = Boolean(organizationId && trimmed.length >= 2 && !items);

    const jumpTo = ({ href }: { href: string }) => {
        router.push(href);
        onClose();
    };
    return (
        <CommandPaletteResults
            query={query}
            clients={clients}
            vault={vault.commands.map(command => ({ id: command.id, label: command.label }))}
            onClose={onClose}
            vaultPending={!vault.ready}
            {...items}
            searchPending={pending}
            onSelectProject={jumpTo}
            onSelectTask={jumpTo}
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
