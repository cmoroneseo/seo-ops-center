'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    CheckCircle2, ChevronLeft, ChevronRight, Plus, Settings2,
    Calendar, ExternalLink, FileText, User as UserIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Deliverable, DeliverableCommitment, OrganizationMember, User,
} from '@/lib/types';
import { getCommitments } from '@/lib/supabase/commitments';
import { getDeliverables } from '@/lib/supabase/deliverables';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { proratedQuantity, fulfillmentStatus } from '@/lib/seo-ops-logic';
import { daysLeftInMonth } from '@/lib/supabase/fulfillment';
import {
    monthKey, monthDisplay, statusBadgeClass, severityBadgeClass,
    typeIcon, typeIconClass, subtypeLabel,
} from './deliverable-ui';
import { CreateDeliverableModal } from './CreateDeliverableModal';
import { DeliverableDetailPanel } from './DeliverableDetailPanel';
import { CommitmentsManager } from './CommitmentsManager';

const DELIVERED = ['Approved', 'Published'];
const IN_PRODUCTION = ['In Progress', 'Review'];

interface ClientDeliverablesTabProps {
    organizationId: string;
    clientId: string;
    clientName: string;
}

export function ClientDeliverablesTab({ organizationId, clientId, clientName }: ClientDeliverablesTabProps) {
    const [monthOffset, setMonthOffset] = useState(0);
    const month = monthKey(monthOffset);
    const [commitments, setCommitments] = useState<DeliverableCommitment[]>([]);
    const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
    const [members, setMembers] = useState<(OrganizationMember & { user: User })[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [createFor, setCreateFor] = useState<DeliverableCommitment | 'adhoc' | null>(null);
    const [selected, setSelected] = useState<Deliverable | null>(null);
    const [showCommitments, setShowCommitments] = useState(false);

    const refetch = useCallback(() => {
        setIsLoading(true);
        Promise.all([
            getCommitments(organizationId, { clientId }),
            getDeliverables(organizationId, { clientId, month }),
        ]).then(([c, d]) => {
            setCommitments(c);
            setDeliverables(d);
            setIsLoading(false);
        });
    }, [organizationId, clientId, month]);

    useEffect(() => { refetch(); }, [refetch]);
    useEffect(() => { getOrganizationMembers(organizationId).then(setMembers); }, [organizationId]);

    const memberName = (id?: string) => {
        if (!id) return undefined;
        const m = members.find((x) => x.userId === id);
        return m?.user.fullName || m?.user.email;
    };

    const activeCommitments = commitments.filter((c) => c.isActive);
    const daysLeft = daysLeftInMonth(month);

    const commitmentRows = useMemo(() => activeCommitments.map((c) => {
        const items = deliverables.filter((d) => d.commitmentId === c.id);
        const promised = proratedQuantity(
            { quantityPerMonth: c.quantityPerMonth, startsOn: c.startsOn, endsOn: c.endsOn },
            month,
        );
        const delivered = items.filter((d) => DELIVERED.includes(d.status)).length;
        const inProgress = items.filter((d) => IN_PRODUCTION.includes(d.status)).length;
        const today = new Date().toISOString().slice(0, 10);
        const overdue = items.filter((d) => d.dueDate && String(d.dueDate).slice(0, 10) < today && !DELIVERED.includes(d.status)).length;
        const pace = fulfillmentStatus({ promised, delivered, inProgress, overdue, daysLeftInMonth: daysLeft });
        return { commitment: c, items, promised, delivered, pace };
    }), [activeCommitments, deliverables, month, daysLeft]);

    const adHocItems = deliverables.filter((d) => !d.commitmentId || !activeCommitments.some((c) => c.id === d.commitmentId));

    const onUpdated = (d: Deliverable) => {
        setDeliverables((prev) => prev.map((x) => (x.id === d.id ? d : x)));
        setSelected(d);
    };

    const renderItem = (item: Deliverable) => (
        <button
            key={item.id}
            onClick={() => setSelected(item)}
            className="w-full text-left group border border-border/50 rounded-lg p-3 hover:bg-muted/30 transition-all flex items-start gap-3"
        >
            <div className={cn('p-2 rounded-md shrink-0', typeIconClass(item.type))}>
                {typeIcon(item.type)}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-medium truncate">{item.title}</h4>
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap', statusBadgeClass(item.status))}>
                        {item.status}
                    </span>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    {item.dueDate && (
                        <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Due {new Date(String(item.dueDate).includes('T') ? item.dueDate : item.dueDate + 'T00:00:00').toLocaleDateString()}
                        </div>
                    )}
                    {memberName(item.assigneeId) && (
                        <div className="flex items-center gap-1">
                            <UserIcon className="h-3 w-3" />
                            {memberName(item.assigneeId)}
                        </div>
                    )}
                    {item.publishedUrl && (
                        <span className="flex items-center gap-1 text-primary">
                            <ExternalLink className="h-3 w-3" />
                            Published
                        </span>
                    )}
                </div>
            </div>
        </button>
    );

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Header: title + month switcher + actions */}
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Deliverables
                </h3>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-background rounded-lg p-1 border border-border">
                        <button
                            onClick={() => setMonthOffset((o) => o - 1)}
                            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-xs font-medium px-1 min-w-[110px] text-center">{monthDisplay(month)}</span>
                        <button
                            onClick={() => setMonthOffset((o) => o + 1)}
                            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    <button
                        onClick={() => setShowCommitments(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
                        title="Manage services"
                    >
                        <Settings2 className="h-3.5 w-3.5" />
                        Services
                    </button>
                </div>
            </div>

            <div className="p-4 space-y-5">
                {isLoading ? (
                    <div className="text-center py-10 text-muted-foreground text-sm">Loading deliverables…</div>
                ) : (
                    <>
                        {/* Commitment groups */}
                        {commitmentRows.map(({ commitment: c, items, promised, delivered, pace }) => (
                            <div key={c.id}>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-sm font-semibold truncate">{c.title}</span>
                                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap', severityBadgeClass(pace.severity))} title={pace.reason}>
                                            {pace.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-xs text-muted-foreground font-medium">
                                            {delivered} of {promised || items.length}{subtypeLabel(c.subtype) ? ` ${subtypeLabel(c.subtype)!.toLowerCase()}s` : ''}
                                        </span>
                                        <button
                                            onClick={() => setCreateFor(c)}
                                            className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
                                            title={`Add to ${c.title}`}
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                                {/* Progress bar */}
                                <div className="h-1.5 rounded-full bg-muted mb-3 overflow-hidden">
                                    <div
                                        className={cn(
                                            'h-full rounded-full transition-all',
                                            pace.severity === 'critical' ? 'bg-red-500' :
                                                pace.severity === 'warn' ? 'bg-yellow-500' : 'bg-green-500',
                                        )}
                                        style={{ width: `${promised > 0 ? Math.min(100, (delivered / promised) * 100) : items.length ? 100 : 0}%` }}
                                    />
                                </div>
                                <div className="space-y-2">
                                    {items.length > 0
                                        ? items.map(renderItem)
                                        : <p className="text-xs text-muted-foreground italic py-1">Nothing generated for {monthDisplay(month)} yet.</p>}
                                </div>
                            </div>
                        ))}

                        {/* Ad-hoc deliverables */}
                        {adHocItems.length > 0 && (
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold text-muted-foreground">Ad hoc</span>
                                </div>
                                <div className="space-y-2">{adHocItems.map(renderItem)}</div>
                            </div>
                        )}

                        {commitmentRows.length === 0 && adHocItems.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-center">
                                <FileText className="h-10 w-10 mb-2 opacity-20" />
                                <p className="text-sm font-medium">No deliverables for {monthDisplay(month)}</p>
                                <p className="text-xs opacity-60">Set up services to auto-generate deliverables monthly</p>
                            </div>
                        )}

                        <button
                            onClick={() => setCreateFor('adhoc')}
                            className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
                        >
                            <Plus className="h-4 w-4" /> Add Deliverable
                        </button>
                    </>
                )}
            </div>

            <CreateDeliverableModal
                isOpen={createFor !== null}
                onClose={() => setCreateFor(null)}
                onCreated={(d) => setDeliverables((prev) => [...prev, d])}
                organizationId={organizationId}
                clientId={clientId}
                commitment={createFor && createFor !== 'adhoc' ? createFor : undefined}
                defaultMonth={month}
            />

            <DeliverableDetailPanel
                deliverable={selected}
                isOpen={selected !== null}
                onClose={() => setSelected(null)}
                onUpdated={onUpdated}
                onDeleted={(id) => setDeliverables((prev) => prev.filter((d) => d.id !== id))}
                organizationId={organizationId}
                clientName={clientName}
            />

            <CommitmentsManager
                isOpen={showCommitments}
                onClose={() => setShowCommitments(false)}
                organizationId={organizationId}
                clientId={clientId}
                clientName={clientName}
                commitments={commitments}
                onChanged={refetch}
            />
        </div>
    );
}
