'use client';

import { useState, useMemo } from 'react';
import { Search, Plus, FolderOpen, Archive } from 'lucide-react';
import { useClients } from '@/lib/hooks/use-clients';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ClientListPanel({
    variant = 'sidebar',
    onNavigate,
}: {
    variant?: 'sidebar' | 'drawer';
    onNavigate?: () => void;
} = {}) {
    const [searchQuery, setSearchQuery] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const pathname = usePathname();

    const { clients: activeClients, isLoading } = useClients({ statuses: ['Active', 'Onboarding'] });
    const { clients: archivedClients } = useClients({ statuses: ['Cancelled', 'Paused'] });

    const displayClients = showArchived ? archivedClients : activeClients;

    const filteredClients = useMemo(() => {
        if (!searchQuery) return displayClients;
        const q = searchQuery.toLowerCase();
        return displayClients.filter(client =>
            client.clientName.toLowerCase().includes(q) ||
            client.accountManager.toLowerCase().includes(q)
        );
    }, [displayClients, searchQuery]);

    return (
        <div className={cn(
            "h-full flex-col bg-muted/30 border-r border-border",
            variant === 'drawer' ? "flex w-full" : "hidden lg:flex w-72"
        )}>
            <div className="p-4 border-b border-border bg-background/50">
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search clients..."
                        className="w-full pl-9 pr-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg">
                    <button
                        onClick={() => setShowArchived(false)}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-all",
                            !showArchived ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <FolderOpen className="h-3.5 w-3.5" />
                        Active
                        <span className="bg-primary/10 text-primary text-[10px] px-1.5 rounded-full">{activeClients.length}</span>
                    </button>
                    <button
                        onClick={() => setShowArchived(true)}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-all",
                            showArchived ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Archive className="h-3.5 w-3.5" />
                        Archived
                        <span className="bg-muted text-muted-foreground text-[10px] px-1.5 rounded-full">{archivedClients.length}</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
                <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {showArchived ? 'Archived Clients' : 'Active Clients'}
                </div>

                {isLoading ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground text-center">Loading...</div>
                ) : filteredClients.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground text-center italic">
                        {searchQuery ? 'No matches' : showArchived ? 'No archived clients' : 'No active clients'}
                    </div>
                ) : (
                    <div className="space-y-1 px-2">
                        {filteredClients.map((client) => {
                            const isTasksPage = pathname.startsWith('/tasks');
                            const targetHref = isTasksPage ? `/tasks?client=${client.id}` : `/workspace/${client.id}`;
                            const isActive = pathname === `/workspace/${client.id}` ||
                                (isTasksPage && pathname.includes(`client=${client.id}`));

                            return (
                                <Link
                                    key={client.id}
                                    href={targetHref}
                                    onClick={onNavigate}
                                    className={cn(
                                        'group flex flex-col gap-1 p-2 rounded-lg transition-all',
                                        isActive
                                            ? 'bg-background shadow-sm border border-border'
                                            : 'hover:bg-background/50'
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className={cn(
                                            "text-sm font-medium truncate",
                                            isActive ? "text-primary font-semibold" : "text-muted-foreground"
                                        )}>
                                            {client.clientName}
                                        </span>
                                        {client.approvals.pendingCount > 0 && (
                                            <span className="bg-red-500 text-white text-[10px] font-bold h-4 w-4 rounded-full flex items-center justify-center shrink-0">
                                                {client.approvals.pendingCount}
                                            </span>
                                        )}
                                    </div>
                                    {isActive && (
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                                T{client.tier} · {client.seoHours}h/mo
                                            </span>
                                            {client.blogProgress.pastDue > 0 && (
                                                <span className="text-[10px] bg-orange-500/10 text-orange-500 px-1.5 py-0.5 rounded italic">
                                                    {client.blogProgress.pastDue} past due
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="p-4 bg-background/50 border-t border-border">
                <Link
                    href="/workspace"
                    onClick={onNavigate}
                    className="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                >
                    <Plus className="h-4 w-4" />
                    Add Client
                </Link>
            </div>
        </div>
    );
}
