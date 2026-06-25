'use client';

import { ClientTable } from '@/components/workspace/ClientTable';
import { AddClientModal } from '@/components/workspace/AddClientModal';
import { CSVImportModal } from '@/components/workspace/CSVImportModal';
import { BasecampImportModal } from '@/components/workspace/BasecampImportModal';
import { PlanningTable } from '@/components/workspace/PlanningTable';
import { ClientProject, ProjectStatus, MonthlyPlan } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Search, Filter, Plus, X, LayoutList, CalendarRange, User } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { getClients } from '@/lib/supabase/clients';
import { getMonthlyPlans } from '@/lib/supabase/monthly-plans';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';

type ManagerFilterOption = {
    value: string;
    label: string;
    accountManagerId?: string;
    aliases: string[];
};

export default function WorkspacePage() {
    const { organization } = useOrganization();
    const { userId, displayName, isOwner } = useCurrentMember();
    const [clients, setClients] = useState<ClientProject[]>([]);
    const [plans, setPlans] = useState<MonthlyPlan[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'All'>('Active');
    const [managerFilter, setManagerFilter] = useState<string>('All');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [bcImportTarget, setBcImportTarget] = useState<{ clientId: string; orgId: string } | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'planning'>('list');
    const [myClientsOnly, setMyClientsOnly] = useState(!isOwner); // members default to their own clients

    const fetchClients = async () => {
        if (!organization) return;
        setIsLoading(true);
        const [data, planData] = await Promise.all([
            getClients(organization.id),
            getMonthlyPlans(organization.id),
        ]);
        setClients(data);
        setPlans(planData);
        setIsLoading(false);
    };

    useEffect(() => {
        fetchClients();
    }, [organization]);

    // Extract unique managers, preferring stable user IDs over display names.
    const managers = useMemo(() => {
        const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
        const isNameVariant = (a: string, b: string) => {
            if (!a || !b) return false;
            return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
        };
        const isBetterName = (next: string, current: string) => next.length > current.length;

        const byId = new Map<string, ManagerFilterOption>();
        const orphanManagers: ManagerFilterOption[] = [];

        for (const client of clients) {
            const label = client.accountManager || 'Unassigned';
            const normalized = normalizeName(label);

            if (client.accountManagerId) {
                const existing = byId.get(client.accountManagerId);
                if (existing) {
                    if (isBetterName(label, existing.label)) existing.label = label;
                    if (!existing.aliases.includes(normalized)) existing.aliases.push(normalized);
                } else {
                    byId.set(client.accountManagerId, {
                        value: client.accountManagerId,
                        label,
                        accountManagerId: client.accountManagerId,
                        aliases: [normalized],
                    });
                }
                continue;
            }

            const existingOrphan = orphanManagers.find((manager) =>
                manager.aliases.some((alias) => isNameVariant(alias, normalized))
            );
            if (existingOrphan) {
                if (isBetterName(label, existingOrphan.label)) existingOrphan.label = label;
                if (!existingOrphan.aliases.includes(normalized)) existingOrphan.aliases.push(normalized);
            } else {
                orphanManagers.push({
                    value: `name:${normalized}`,
                    label,
                    aliases: [normalized],
                });
            }
        }

        const mergedOrphans: typeof orphanManagers = [];
        for (const orphan of orphanManagers) {
            const idMatch = Array.from(byId.values()).find((manager) =>
                manager.aliases.some((alias) =>
                    orphan.aliases.some((orphanAlias) => isNameVariant(alias, orphanAlias))
                )
            );
            if (idMatch) {
                if (isBetterName(orphan.label, idMatch.label)) idMatch.label = orphan.label;
                for (const alias of orphan.aliases) {
                    if (!idMatch.aliases.includes(alias)) idMatch.aliases.push(alias);
                }
            } else {
                mergedOrphans.push(orphan);
            }
        }

        return [...byId.values(), ...mergedOrphans].sort((a, b) => a.label.localeCompare(b.label));
    }, [clients]);

    // Filter clients
    const filteredClients = useMemo(() => {
        const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
        const selectedManager = managers.find((manager) => manager.value === managerFilter);

        return clients.filter(client => {
            const matchesSearch =
                client.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                client.accountManager.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = statusFilter === 'All' || client.status === statusFilter;
            const matchesManager = managerFilter === 'All' ||
                (selectedManager
                    ? client.accountManagerId
                        ? client.accountManagerId === selectedManager.accountManagerId
                        : selectedManager.aliases.includes(normalizeName(client.accountManager))
                    : false);
            const matchesMine = !myClientsOnly ||
                (client.accountManagerId && client.accountManagerId === userId) ||
                (!client.accountManagerId && client.accountManager.toLowerCase().includes(displayName.toLowerCase()));
            return matchesSearch && matchesStatus && matchesManager && matchesMine;
        });
    }, [clients, searchQuery, statusFilter, managerFilter, myClientsOnly, userId, displayName, managers]);

    if (isLoading) return <div className="p-8">Loading client workspace...</div>;

    return (
        <div className="space-y-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight neon-gradient-text">Workspace</h2>
                    <p className="text-muted-foreground">Manage your clients and SEO deliverables.</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                    {/* My Clients toggle */}
                    <button
                        onClick={() => setMyClientsOnly(p => !p)}
                        className={cn(
                            "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all",
                            myClientsOnly
                                ? "bg-primary/10 text-primary border-primary/30"
                                : "bg-muted/50 text-muted-foreground border-border/50 hover:text-foreground"
                        )}
                    >
                        <User className="h-4 w-4" />
                        <span className="hidden sm:inline">{myClientsOnly ? 'My Clients' : 'All Clients'}</span>
                    </button>

                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border border-border/50">
                        <button
                            onClick={() => setViewMode('list')}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                                viewMode === 'list' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <LayoutList className="h-4 w-4" />
                            <span className="hidden sm:inline">List</span>
                        </button>
                        <button
                            onClick={() => setViewMode('planning')}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                                viewMode === 'planning' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <CalendarRange className="h-4 w-4" />
                            <span className="hidden sm:inline">Planning</span>
                        </button>
                    </div>

                    {isOwner && (
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 w-full sm:w-auto justify-center"
                        >
                            <Plus className="h-4 w-4" />
                            Add Client
                        </button>
                    )}
                </div>
            </div>

            {/* Filters and Search Bar */}
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border border-border/50">
                <div className="relative w-full sm:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search clients..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-md bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
                    <div className="relative">
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'All')}
                            className="appearance-none pl-9 pr-8 py-2 rounded-md bg-muted/50 hover:bg-muted text-sm font-medium transition-colors cursor-pointer border-none focus:ring-2 focus:ring-primary/50"
                        >
                            <option value="Active">Active</option>
                            <option value="All">All Statuses</option>
                            <option value="Onboarding">Onboarding</option>
                            <option value="Paused">Paused</option>
                            <option value="Cancelled">Cancelled (Archived)</option>
                        </select>
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>

                    <div className="relative">
                        <select
                            value={managerFilter}
                            onChange={(e) => setManagerFilter(e.target.value)}
                            className="appearance-none pl-9 pr-8 py-2 rounded-md bg-muted/50 hover:bg-muted text-sm font-medium transition-colors cursor-pointer border-none focus:ring-2 focus:ring-primary/50"
                        >
                            <option value="All">All Managers</option>
                            {managers.map(manager => (
                                <option key={manager.value} value={manager.value}>{manager.label}</option>
                            ))}
                        </select>
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="flex-1">
                {viewMode === 'list' ? (
                    <ClientTable clients={filteredClients} />
                ) : (
                    <PlanningTable clients={filteredClients} plans={plans} />
                )}
                <div className="mt-4 text-sm text-muted-foreground text-center">
                    Showing {filteredClients.length} of {clients.length} clients
                </div>
            </div>

            <AddClientModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={fetchClients}
                onImportFromBasecamp={(clientId, orgId) => setBcImportTarget({ clientId, orgId })}
            />

            {bcImportTarget && organization && (
                <BasecampImportModal
                    isOpen={true}
                    onClose={() => setBcImportTarget(null)}
                    onSuccess={() => { setBcImportTarget(null); }}
                    clientId={bcImportTarget.clientId}
                    organizationId={bcImportTarget.orgId}
                />
            )}

            <CSVImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onSuccess={fetchClients}
            />
        </div>
    );
}
