'use client';

import { useEffect, useState } from 'react';
import { RoadmapPanel } from '@/components/campaign-workspace/RoadmapPanel';
import { loadClientInitiativeTasks } from '@/lib/campaign-workspace/initiative-tasks';
import type { CampaignInitiative } from '@/lib/campaign-workspace/initiatives';
import type { PartOfTask } from '@/lib/tasks/part-of';

export function InitiativeRoadmap({
    initiatives,
    today,
    message,
    clientId,
    organizationId,
    selectedId,
    onSelect,
    onSaved,
    reloadToken,
}: {
    initiatives: readonly CampaignInitiative[];
    today: string;
    message: string | null;
    clientId?: string;
    organizationId?: string;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onSaved: (id: string) => void;
    reloadToken: number;
}) {
    const [links, setLinks] = useState<readonly PartOfTask[]>([]);
    useEffect(() => {
        if (!clientId) {
            setLinks([]);
            return;
        }
        let cancelled = false;
        void loadClientInitiativeTasks(clientId).then(rows => {
            if (!cancelled) setLinks(rows);
        });
        return () => { cancelled = true; };
    }, [clientId, reloadToken]);

    return (
        <RoadmapPanel
            initiatives={initiatives}
            today={today}
            message={message}
            clientId={clientId}
            organizationId={organizationId}
            selectedId={selectedId}
            onSelect={onSelect}
            onSaved={onSaved}
            links={links}
        />
    );
}
