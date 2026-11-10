'use client';

import type { KeyboardEvent } from 'react';
import { PerformanceFreshness } from '@/components/opportunities/PerformanceFreshness';
import { SearchDashboard } from '@/components/search-dashboard/SearchDashboard';
import { RankingsTab } from '@/components/workspace/RankingsTab';
import { LegacySearchInsights } from '@/components/workspace/SearchInsightsTab';
import { SiteInventoryTab } from '@/components/workspace/SiteInventoryTab';
import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import {
    opportunityViews,
    type OpportunityRange,
    type OpportunityView,
} from '@/lib/opportunities/view';
import { cn } from '@/lib/utils';

export function OpportunitiesTab({
    organizationId,
    clientId,
    clientName,
    view,
    range,
    showFreshness,
    onView,
    onRange,
    onConnections,
}: {
    organizationId: string;
    clientId: string;
    clientName: string;
    view: OpportunityView;
    range: OpportunityRange;
    showFreshness: boolean;
    onView: (view: OpportunityView) => void;
    onRange: (range: OpportunityRange) => void;
    onConnections: () => void;
}) {
    const tracking = keywordTrackingEnabled();
    const views = opportunityViews(tracking);
    const selected = views.some(item => item.id === view) ? view : 'performance';

    const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
        const current = views.findIndex(item => item.id === selected);
        const nextIndex = event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (current + 1) % views.length
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                ? (current - 1 + views.length) % views.length
                : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                        ? views.length - 1
                        : -1;
        if (nextIndex < 0 || nextIndex === current) return;
        event.preventDefault();
        const next = views[nextIndex];
        if (!next) return;
        onView(next.id);
        document.getElementById(`opportunities-tab-${next.id}`)?.focus();
    };

    return (
        <section className="min-w-0" aria-label="Opportunities">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight">Opportunities</h2>
                <div className="flex flex-wrap items-center gap-2">
                    <div role="tablist" aria-label="Opportunities" className="flex rounded-lg border border-border p-0.5" onKeyDown={onTabKey}>
                        {views.map(item => {
                            const active = selected === item.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="tab"
                                    id={`opportunities-tab-${item.id}`}
                                    aria-selected={active}
                                    aria-controls="opportunities-panel"
                                    tabIndex={active ? 0 : -1}
                                    onClick={() => onView(item.id)}
                                    className={cn(
                                        'rounded-md px-2.5 py-1 text-xs font-medium',
                                        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>
                    {selected === 'performance' ? (
                        <div role="group" aria-label="Date range" className="flex rounded-lg border border-border p-0.5">
                            {([7, 28, 90] as const).map(days => {
                                const active = range === days;
                                return (
                                    <button
                                        key={days}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => onRange(days)}
                                        className={cn(
                                            'rounded-md px-2 py-1 text-xs font-medium tabular-nums',
                                            active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                                        )}
                                    >
                                        {days}d
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            </div>
            <div role="tabpanel" id="opportunities-panel" aria-labelledby={`opportunities-tab-${selected}`} className="min-w-0">
                {selected === 'performance' ? (
                    <div className="space-y-4">
                        {showFreshness ? <PerformanceFreshness clientId={clientId} refreshKey={String(range)} /> : null}
                        <SearchDashboard
                            organizationId={organizationId}
                            clientId={clientId}
                            clientName={clientName}
                            onConnections={onConnections}
                            windowDays={range}
                            embedded
                        />
                    </div>
                ) : null}
                {selected === 'backlog' ? (
                    <LegacySearchInsights
                        organizationId={organizationId}
                        clientId={clientId}
                        clientName={clientName}
                        onConnections={onConnections}
                        variant="evidence"
                    />
                ) : null}
                {selected === 'rankings' && tracking ? (
                    <RankingsTab organizationId={organizationId} clientId={clientId} />
                ) : null}
                {selected === 'health' ? (
                    <SiteInventoryTab clientId={clientId} clientName={clientName} />
                ) : null}
            </div>
        </section>
    );
}
