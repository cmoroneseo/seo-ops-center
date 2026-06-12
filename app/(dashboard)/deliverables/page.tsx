'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Package, PackageCheck, ChevronLeft, ChevronRight, RefreshCw,
    Factory, AlertTriangle, Percent, X, Calendar, User as UserIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Deliverable, DeliverableType } from '@/lib/types';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { useClients } from '@/lib/hooks/use-clients';
import { getFulfillmentMatrix, FulfillmentMatrixData, daysLeftInMonth } from '@/lib/supabase/fulfillment';
import { KPICard } from '@/components/dashboard/KPICard';
import { FulfillmentMatrix } from '@/components/deliverables/FulfillmentMatrix';
import { AtRiskRail } from '@/components/deliverables/AtRiskRail';
import { DeliverableDetailPanel } from '@/components/deliverables/DeliverableDetailPanel';
import {
    monthKey, monthDisplay, statusBadgeClass, typeIcon, typeIconClass,
} from '@/components/deliverables/deliverable-ui';

type Lens = 'queue' | 'clients' | 'agency';
const DELIVERED = ['Approved', 'Published'];

export default function DeliverablesPage() {
    const { organization } = useOrganization();
    const { userId, displayName, isOwner } = useCurrentMember();
    const { clients } = useClients({ statuses: ['Active', 'Onboarding'] });

    const [monthOffset, setMonthOffset] = useState(0);
    const month = monthKey(monthOffset);
    const [data, setData] = useState<FulfillmentMatrixData | null>(null);
    const [lens, setLens] = useState<Lens | null>(null);
    const [selected, setSelected] = useState<Deliverable | null>(null);
    const [cellFilter, setCellFilter] = useState<{ clientId: string; type: DeliverableType } | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // Default lens by role once membership resolves
    useEffect(() => {
        if (lens === null && userId) setLens(isOwner ? 'agency' : 'queue');
    }, [userId, isOwner, lens]);

    const refetch = useCallback(() => {
        if (!organization) return;
        getFulfillmentMatrix(organization.id, month).then(setData);
    }, [organization?.id, month]);

    useEffect(() => { refetch(); }, [refetch]);

    const clientNameById = useMemo(
        () => new Map(clients.map((c) => [c.id, c.clientName])),
        [clients],
    );

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            await fetch('/api/cron/generate-deliverables', { method: 'POST' });
            refetch();
        } finally {
            setIsGenerating(false);
        }
    };

    const activeLens: Lens = lens ?? 'agency';

    // Lens-scoped data
    const myClientIds = useMemo(
        () => new Set(clients.filter((c) => c.accountManager === displayName).map((c) => c.id)),
        [clients, displayName],
    );
    const deliverables = data?.deliverables ?? [];
    const lensDeliverables = activeLens === 'queue'
        ? deliverables.filter((d) => d.assigneeId === userId)
        : activeLens === 'clients'
            ? deliverables.filter((d) => myClientIds.has(d.clientId))
            : deliverables;
    const lensCells = activeLens === 'clients'
        ? (data?.cells ?? []).filter((c) => myClientIds.has(c.clientId))
        : (data?.cells ?? []);
    const lensClients = (activeLens === 'clients'
        ? clients.filter((c) => myClientIds.has(c.id))
        : clients
    ).map((c) => ({ id: c.id, name: c.clientName, accountManager: c.accountManager }));

    // KPIs
    const daysLeft = daysLeftInMonth(month);
    const today = new Date().toISOString().slice(0, 10);
    const promised = lensCells.reduce((s, c) => s + Math.max(c.promised, 0), 0);
    const delivered = lensDeliverables.filter((d) => DELIVERED.includes(d.status)).length;
    const inProduction = lensDeliverables.filter((d) => ['In Progress', 'Review'].includes(d.status)).length;
    const overdueCount = lensDeliverables.filter(
        (d) => d.dueDate && String(d.dueDate).slice(0, 10) < today && !DELIVERED.includes(d.status),
    ).length;
    const fulfillmentPct = promised > 0 ? Math.round((delivered / promised) * 100) : null;

    // Cell drill-down list
    const cellItems = cellFilter
        ? deliverables.filter((d) => d.clientId === cellFilter.clientId && d.type === cellFilter.type)
        : [];

    const onUpdated = (d: Deliverable) => {
        setData((prev) => prev ? { ...prev, deliverables: prev.deliverables.map((x) => x.id === d.id ? d : x) } : prev);
        setSelected(d);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight neon-gradient-text flex items-center gap-2">
                        <PackageCheck className="h-7 w-7" />
                        Deliverables
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Promised vs delivered across every client agreement
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Lens switcher */}
                    <div className="flex bg-card rounded-lg p-1 border border-border">
                        {([
                            { key: 'queue', label: 'My Queue' },
                            { key: 'clients', label: 'My Clients' },
                            { key: 'agency', label: 'Agency' },
                        ] as { key: Lens; label: string }[]).map((l) => (
                            <button
                                key={l.key}
                                onClick={() => setLens(l.key)}
                                className={cn(
                                    'px-3 py-1.5 text-xs font-medium rounded transition-all',
                                    activeLens === l.key
                                        ? 'bg-primary text-primary-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {l.label}
                            </button>
                        ))}
                    </div>
                    {/* Month switcher */}
                    <div className="flex items-center gap-1 bg-card rounded-lg p-1 border border-border">
                        <button onClick={() => setMonthOffset((o) => o - 1)} className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors">
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-sm font-medium px-1 min-w-[130px] text-center">{monthDisplay(month)}</span>
                        <button onClick={() => setMonthOffset((o) => o + 1)} className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors">
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        title="Generate this month's deliverables from commitments now"
                        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all disabled:opacity-50"
                    >
                        <RefreshCw className={cn('h-4 w-4', isGenerating && 'animate-spin')} />
                        {isGenerating ? 'Generating…' : 'Generate now'}
                    </button>
                </div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <KPICard title="Promised" value={String(promised)} change={monthDisplay(month)} trend="neutral" icon={Package} />
                <KPICard title="Delivered" value={String(delivered)} change={promised > 0 ? `of ${promised}` : ''} trend={delivered >= promised && promised > 0 ? 'up' : 'neutral'} icon={PackageCheck} />
                <KPICard title="In Production" value={String(inProduction)} change="" trend="neutral" icon={Factory} />
                <KPICard title="Overdue" value={String(overdueCount)} change="" trend={overdueCount > 0 ? 'down' : 'neutral'} icon={AlertTriangle} />
                <KPICard title="Fulfillment" value={fulfillmentPct === null ? '—' : `${fulfillmentPct}%`} change={`${daysLeft}d left`} trend={fulfillmentPct !== null && fulfillmentPct >= 100 ? 'up' : 'neutral'} icon={Percent} />
            </div>

            {/* Matrix + rail */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    {activeLens === 'queue' ? (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="p-4 border-b border-border bg-muted/30">
                                <h3 className="font-semibold flex items-center gap-2">
                                    <UserIcon className="h-4 w-4 text-primary" />
                                    My Queue — {monthDisplay(month)}
                                </h3>
                            </div>
                            <div className="p-4 space-y-2">
                                {lensDeliverables.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-center">
                                        <PackageCheck className="h-10 w-10 mb-2 opacity-20" />
                                        <p className="text-sm font-medium">Nothing assigned to you this month</p>
                                    </div>
                                ) : (
                                    [...lensDeliverables]
                                        .sort((a, b) => String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')))
                                        .map((d) => (
                                            <button
                                                key={d.id}
                                                onClick={() => setSelected(d)}
                                                className="w-full text-left border border-border/50 rounded-lg p-3 hover:bg-muted/30 transition-all flex items-center gap-3"
                                            >
                                                <div className={cn('p-2 rounded-md shrink-0', typeIconClass(d.type))}>
                                                    {typeIcon(d.type)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium truncate">{d.title}</div>
                                                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                                        <span>{clientNameById.get(d.clientId) ?? '—'}</span>
                                                        {d.dueDate && (
                                                            <span className="flex items-center gap-1">
                                                                <Calendar className="h-3 w-3" />
                                                                {new Date(String(d.dueDate) + 'T00:00:00').toLocaleDateString()}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap', statusBadgeClass(d.status))}>
                                                    {d.status}
                                                </span>
                                            </button>
                                        ))
                                )}
                            </div>
                        </div>
                    ) : (
                        <FulfillmentMatrix
                            clients={lensClients}
                            cells={lensCells}
                            daysLeftInMonth={daysLeft}
                            onCellClick={(clientId, type) => setCellFilter({ clientId, type })}
                        />
                    )}
                </div>
                <AtRiskRail
                    deliverables={lensDeliverables}
                    clientNameById={clientNameById}
                    onItemClick={setSelected}
                />
            </div>

            {/* Cell drill-down slide-over */}
            {cellFilter && (
                <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" onClick={() => setCellFilter(null)}>
                    <div
                        className="w-full max-w-sm h-full bg-card border-l border-border shadow-xl overflow-y-auto animate-in slide-in-from-right duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-border/50 bg-card">
                            <h3 className="font-semibold text-sm">
                                {clientNameById.get(cellFilter.clientId) ?? 'Client'} — {cellFilter.type}
                            </h3>
                            <button onClick={() => setCellFilter(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-4 space-y-2">
                            {cellItems.map((d) => (
                                <button
                                    key={d.id}
                                    onClick={() => setSelected(d)}
                                    className="w-full text-left border border-border/50 rounded-lg p-3 hover:bg-muted/30 transition-all"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-sm font-medium truncate">{d.title}</span>
                                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap', statusBadgeClass(d.status))}>
                                            {d.status}
                                        </span>
                                    </div>
                                    {d.dueDate && (
                                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            Due {new Date(String(d.dueDate) + 'T00:00:00').toLocaleDateString()}
                                        </div>
                                    )}
                                </button>
                            ))}
                            {cellItems.length === 0 && (
                                <p className="text-sm text-muted-foreground italic text-center py-6">No deliverables yet</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <DeliverableDetailPanel
                deliverable={selected}
                isOpen={selected !== null}
                onClose={() => setSelected(null)}
                onUpdated={onUpdated}
                onDeleted={(id) => setData((prev) => prev ? { ...prev, deliverables: prev.deliverables.filter((d) => d.id !== id) } : prev)}
                organizationId={organization?.id ?? ''}
                clientName={selected ? clientNameById.get(selected.clientId) : undefined}
            />
        </div>
    );
}
