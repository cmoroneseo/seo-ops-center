'use client';

import { useEffect, useState } from 'react';
import { useOrganization } from '@/components/providers/organization-provider';
import { getClients } from '@/lib/supabase/clients';
import { ClientProject, ProjectStatus } from '@/lib/types';

interface UseClientsOptions {
    statuses?: ProjectStatus[]; // defaults to ['Active'] — only active clients shown by default
}

interface UseClientsResult {
    clients: ClientProject[];
    isLoading: boolean;
    refresh: () => void;
}

export function useClients(opts: UseClientsOptions = {}): UseClientsResult {
    const { organization } = useOrganization();
    const [allClients, setAllClients] = useState<ClientProject[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [tick, setTick] = useState(0);

    const statuses = opts.statuses ?? ['Active'];

    useEffect(() => {
        if (!organization) { setIsLoading(false); return; }
        let cancelled = false;
        setIsLoading(true);
        getClients(organization.id).then((data) => {
            if (!cancelled) {
                setAllClients(data);
                setIsLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [organization?.id, tick]);

    const clients = statuses.includes('All' as ProjectStatus)
        ? allClients
        : allClients.filter(c => statuses.includes(c.status));

    return { clients, isLoading, refresh: () => setTick(t => t + 1) };
}
