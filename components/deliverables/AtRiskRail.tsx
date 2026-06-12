'use client';

import { AlertTriangle, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Deliverable } from '@/lib/types';
import { statusBadgeClass, typeIcon, typeIconClass } from './deliverable-ui';

const DELIVERED = ['Approved', 'Published'];

interface AtRiskRailProps {
    deliverables: Deliverable[];
    clientNameById: Map<string, string>;
    onItemClick: (d: Deliverable) => void;
}

export function AtRiskRail({ deliverables, clientNameById, onItemClick }: AtRiskRailProps) {
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

    const overdue = deliverables
        .filter((d) => d.dueDate && String(d.dueDate).slice(0, 10) < today && !DELIVERED.includes(d.status))
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const dueSoon = deliverables
        .filter((d) => {
            const due = d.dueDate ? String(d.dueDate).slice(0, 10) : null;
            return due && due >= today && due <= soon && !DELIVERED.includes(d.status);
        })
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

    const renderGroup = (title: string, items: Deliverable[], critical: boolean) => (
        items.length > 0 && (
            <div>
                <div className={cn('text-xs font-bold uppercase tracking-wider mb-2', critical ? 'text-red-500' : 'text-yellow-500')}>
                    {title} ({items.length})
                </div>
                <div className="space-y-2">
                    {items.map((d) => (
                        <button
                            key={d.id}
                            onClick={() => onItemClick(d)}
                            className="w-full text-left border border-border/50 rounded-lg p-2.5 hover:bg-muted/30 transition-all flex items-center gap-2.5"
                        >
                            <div className={cn('p-1.5 rounded-md shrink-0', typeIconClass(d.type))}>
                                {typeIcon(d.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium truncate">{d.title}</div>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                                    <span className="truncate">{clientNameById.get(d.clientId) ?? '—'}</span>
                                    <span className={cn('flex items-center gap-0.5 shrink-0', critical && 'text-red-500 font-medium')}>
                                        <Calendar className="h-2.5 w-2.5" />
                                        {d.dueDate ? new Date(String(d.dueDate).includes('T') ? d.dueDate : d.dueDate + 'T00:00:00').toLocaleDateString() : ''}
                                    </span>
                                </div>
                            </div>
                            <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border whitespace-nowrap shrink-0', statusBadgeClass(d.status))}>
                                {d.status}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        )
    );

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/30">
                <h3 className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    Needs Attention
                </h3>
            </div>
            <div className="p-4 space-y-4">
                {overdue.length === 0 && dueSoon.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-center">
                        <AlertTriangle className="h-8 w-8 mb-2 opacity-20" />
                        <p className="text-sm font-medium">All clear</p>
                        <p className="text-xs opacity-60">Nothing overdue or due in the next 3 days</p>
                    </div>
                ) : (
                    <>
                        {renderGroup('Overdue', overdue, true)}
                        {renderGroup('Due soon', dueSoon, false)}
                    </>
                )}
            </div>
        </div>
    );
}
