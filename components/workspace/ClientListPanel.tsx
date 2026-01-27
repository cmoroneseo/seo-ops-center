'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronRight, Plus, FolderOpen, Filter } from 'lucide-react';
import { mockClients } from '@/lib/mock-data/workspace';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ClientListPanel() {
    const [searchQuery, setSearchQuery] = useState('');
    const pathname = usePathname();

    const filteredClients = useMemo(() => {
        return mockClients.filter(client =>
            client.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            client.accountManager.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery]);

    return (
        <div className="flex h-full w-72 flex-col bg-muted/30 border-r border-border">
            <div className="p-4 border-b border-border bg-background/50">
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search projects..."
                        className="w-full pl-9 pr-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1 mb-2">
                    <span className="flex items-center gap-1.5 text-red-500">
                        Active Filter
                        <button className="text-[10px] lowercase font-normal text-muted-foreground hover:text-foreground">× Clear</button>
                    </span>
                </div>

                <button className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-background transition-colors text-sm font-medium text-foreground">
                    <FolderOpen className="h-4 w-4 text-blue-500" />
                    All Projects
                </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
                <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Clients
                </div>
                <div className="space-y-1 px-2">
                    {filteredClients.map((client) => {
                        const isTasksPage = pathname.startsWith('/tasks');
                        const targetHref = isTasksPage ? `/tasks?client=${client.id}` : `/workspace/${client.id}`;
                        const isActive = pathname === `/workspace/${client.id}` || (isTasksPage && pathname.includes(`client=${client.id}`));

                        return (
                            <Link
                                key={client.id}
                                href={targetHref}
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
                                        <span className="bg-red-500 text-white text-[10px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                                            {client.approvals.pendingCount}
                                        </span>
                                    )}
                                </div>

                                {isActive && (
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[10px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded">Basic Hosting</span>
                                        {client.blogProgress.pastDue > 0 && (
                                            <span className="text-[10px] bg-orange-500/10 text-orange-500 px-1.5 py-0.5 rounded italic">past_due</span>
                                        )}
                                    </div>
                                )}
                            </Link>
                        );
                    })}
                </div>
            </div>

            <div className="p-4 bg-background/50 border-t border-border">
                <button className="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors">
                    <Plus className="h-4 w-4" />
                    Add Project
                </button>
            </div>
        </div>
    );
}
