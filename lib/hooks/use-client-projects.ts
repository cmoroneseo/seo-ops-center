'use client';

import { useEffect, useState } from 'react';
import { orderedInitiatives, type CampaignInitiative } from '@/lib/campaign-workspace/initiatives';
import { PROJECTS_CHANGED_EVENT } from '@/lib/nav/sidebar-projects';
import { listCampaignInitiatives } from '@/lib/supabase/campaign-initiatives';

interface ProjectResult {
    clientId: string;
    organizationId?: string | null;
    projects: CampaignInitiative[];
    unavailable: boolean;
}

const EMPTY_PROJECTS: CampaignInitiative[] = [];

export function useClientProjects(clientId: string | null, organizationId?: string | null) {
    const [result, setResult] = useState<ProjectResult | null>(null);

    useEffect(() => {
        if (!clientId) return;
        const id = clientId;
        let request = 0;

        async function refresh() {
            const current = ++request;
            let projects = EMPTY_PROJECTS;
            let unavailable = true;
            try {
                const response = await listCampaignInitiatives(id, { includeItems: false });
                projects = orderedInitiatives(organizationId
                    ? response.initiatives.filter(project => project.organizationId === organizationId)
                    : response.initiatives);
                unavailable = response.unavailable;
            } catch {
                // A failed read keeps the unavailable state.
            }
            if (current === request) setResult({ clientId: id, organizationId, projects, unavailable });
        }

        function onChanged(event: Event) {
            const changedId = (event as CustomEvent<string | undefined>).detail;
            if (changedId == null || changedId === '*' || changedId === id) void refresh();
        }

        window.addEventListener(PROJECTS_CHANGED_EVENT, onChanged);
        void refresh();
        return () => {
            request++;
            window.removeEventListener(PROJECTS_CHANGED_EVENT, onChanged);
        };
    }, [clientId, organizationId]);

    const current = result?.clientId === clientId && result.organizationId === organizationId ? result : null;
    return {
        projects: current?.projects ?? EMPTY_PROJECTS,
        loading: clientId !== null && current === null,
        unavailable: current?.unavailable ?? false,
    };
}
