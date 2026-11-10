'use client';

import { SearchDashboard } from '@/components/search-dashboard/SearchDashboard';
import { investigationLookupKey, taskPrefillForInvestigation, type InvestigationIdentityInput } from '@/lib/gsc/investigations';
import type { SearchInvestigation } from '@/lib/types';

export function investigationTaskHandoff(decision: SearchInvestigation, clientName: string) {
    const prefill = taskPrefillForInvestigation(decision.evidenceSnapshot, clientName);
    return {
        defaultTitle: prefill.title,
        defaultDescription: prefill.description,
        defaultCategory: prefill.category,
        defaultPriority: prefill.priority,
        defaultTags: prefill.tags,
        sourceInvestigationId: decision.id,
    };
}

export function mapInvestigationsByIdentity(investigations: SearchInvestigation[], property?: string) {
    const decisions = new Map<string, SearchInvestigation>();
    if (!property) return decisions;
    for (const decision of investigations) {
        if (decision.property !== property) continue;
        try {
            const key = investigationLookupKey({
                kind: decision.kind,
                ...(decision.query ? { query: decision.query } : {}),
                ...(decision.page ? { page: decision.page } : {}),
            } as InvestigationIdentityInput);
            decisions.set(key, decision);
        } catch {
            // A malformed historical row must not hide current GSC evidence.
        }
    }
    return decisions;
}

export function SearchInsightsTab(props: { organizationId: string; clientId: string; clientName: string; onConnections: () => void; onSiteInventory?: () => void }) {
    return (
        <SearchDashboard
            organizationId={props.organizationId}
            clientId={props.clientId}
            clientName={props.clientName}
            onConnections={props.onConnections}
        />
    );
}
