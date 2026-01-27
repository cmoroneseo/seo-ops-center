'use client';

import { ClientTable } from '@/components/workspace/ClientTable';
import { AddClientModal } from '@/components/workspace/AddClientModal';
import { CSVImportModal } from '@/components/workspace/CSVImportModal';
import { PlanningTable } from '@/components/workspace/PlanningTable';
import { mockClients, mockMonthlyPlans } from '@/lib/mock-data/workspace';
import { ClientProject, ProjectStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Search, Filter, Plus, X, LayoutList, CalendarRange, Upload } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { getClients } from '@/lib/supabase/clients';
import { useOrganization } from '@/components/providers/organization-provider';

export default function WorkspacePage() {
    const { organization } = useOrganization();
    const [clients, setClients] = useState<ClientProject[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'All'>('All');
    const [managerFilter, setManagerFilter] = useState<string>('All');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'planning'>('list');

    const fetchClients = async () => {
        if (!organization) return;
        setIsLoading(true);
        const data = await getClients(organization.id);
        setClients(data);
        setIsLoading(false);
    };

    useEffect(() => {
        fetchClients();
    }, [organization]);

    // Extract unique managers
    const managers = useMemo(() => {
        const uniqueManagers = new Set(clients.map(c => c.accountManager));
        return Array.from(uniqueManagers).sort();
    }, [clients]);

    // Filter clients
    const filteredClients = useMemo(() => {
        return clients.filter(client => {
            // Search filter
            const matchesSearch =
                client.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                client.accountManager.toLowerCase().includes(searchQuery.toLowerCase());

            // Status filter
            const matchesStatus = statusFilter === 'All' || client.status === statusFilter;

            // Manager filter
            const matchesManager = managerFilter === 'All' || client.accountManager === managerFilter;

            return matchesSearch && matchesStatus && matchesManager;
        });
    }, [clients, searchQuery, statusFilter, managerFilter]);

    if (isLoading) return <div className="p-8">Loading client workspace...</div>;

    return (
        <div className="space-y-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight neon-gradient-text">Workspace</h2>
                    <p className="text-muted-foreground">Manage your clients and SEO deliverables.</p>
                </div>
                <div className="flex items-center gap-3">
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
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 w-full sm:w-auto justify-center"
                    >
                        <Plus className="h-4 w-4" />
                        Add Client
                    </button>
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
                            <option value="All">All Statuses</option>
                            <option value="Active">Active</option>
                            <option value="Paused">Paused</option>
                            <option value="Cancelled">Cancelled</option>
                            <option value="Onboarding">Onboarding</option>
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
                                <option key={manager} value={manager}>{manager}</option>
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
                    <PlanningTable clients={filteredClients} plans={mockMonthlyPlans} />
                )}
                <div className="mt-4 text-sm text-muted-foreground text-center">
                    Showing {filteredClients.length} of {clients.length} clients
                </div>
            </div>

            <AddClientModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={fetchClients}
            />

            <CSVImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onSuccess={fetchClients}
            />
        </div>
    );
}
