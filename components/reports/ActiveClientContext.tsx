'use client';

// Global-style "project switcher" context, scoped to the Reports section
// (mirrors SE Ranking's always-visible project selector). Persists the
// active client per-organization in localStorage so it survives navigation
// between the reports list, the builder, and back.

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useOrganization } from '@/components/providers/organization-provider';
import { useClients } from '@/lib/hooks/use-clients';
import { ClientProject } from '@/lib/types';

interface ActiveClientCtx {
    clients: ClientProject[];
    isLoading: boolean;
    activeClient: ClientProject | null;
    setActiveClientId: (id: string) => void;
}

const Ctx = createContext<ActiveClientCtx | null>(null);

const storageKey = (orgId: string) => `reports:activeClient:${orgId}`;

export function ActiveClientProvider({ children }: { children: ReactNode }) {
    const { organization } = useOrganization();
    const { clients, isLoading } = useClients({ statuses: ['Active'] });
    const [activeId, setActiveId] = useState<string | null>(null);

    // Restore persisted selection once the org is known.
    useEffect(() => {
        if (!organization) return;
        const saved = typeof window !== 'undefined' ? localStorage.getItem(storageKey(organization.id)) : null;
        if (saved) setActiveId(saved);
    }, [organization?.id]);

    // Default to the first active client once the list loads, if nothing is selected
    // or the saved selection no longer exists (e.g. client archived).
    useEffect(() => {
        if (isLoading || clients.length === 0) return;
        if (activeId && clients.some(c => c.id === activeId)) return;
        setActiveId(clients[0].id);
    }, [isLoading, clients, activeId]);

    const setActiveClientId = (id: string) => {
        setActiveId(id);
        if (organization) localStorage.setItem(storageKey(organization.id), id);
    };

    const activeClient = clients.find(c => c.id === activeId) ?? null;

    return (
        <Ctx.Provider value={{ clients, isLoading, activeClient, setActiveClientId }}>
            {children}
        </Ctx.Provider>
    );
}

export function useActiveClient(): ActiveClientCtx {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useActiveClient must be used within ActiveClientProvider');
    return ctx;
}
