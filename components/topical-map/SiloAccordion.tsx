'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SearchIntent, TopicalMapRecord, TopicalMapSilo } from '@/lib/types';
import { computeSiloStats } from '@/lib/topical-map/stats';
import { RecordRow } from './RecordRow';

const INTENT_COLOR: Record<SearchIntent, string> = {
    transactional: 'bg-emerald-500',
    commercial: 'bg-amber-500',
    informational: 'bg-sky-500',
    navigational: 'bg-violet-500',
};

function sortRecords(records: TopicalMapRecord[]): TopicalMapRecord[] {
    return [...records].sort((a, b) => a.sortOrder - b.sortOrder);
}

interface SiloAccordionProps {
    silo: TopicalMapSilo;
    records: TopicalMapRecord[];
    onSelectRecord: (record: TopicalMapRecord) => void;
    defaultOpen?: boolean;
}

export function SiloAccordion({ silo, records, onSelectRecord, defaultOpen = true }: SiloAccordionProps) {
    const [open, setOpen] = useState(defaultOpen);
    const stats = computeSiloStats(records, silo.id);

    const siloRecords = sortRecords(records.filter(r => r.siloId === silo.id));
    const topLevel = siloRecords.filter(r => !r.parentRecordId);
    const childrenOf = (id: string) => sortRecords(siloRecords.filter(r => r.parentRecordId === id));

    return (
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <button
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/30"
            >
                {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', INTENT_COLOR[silo.searchIntent])} title={silo.searchIntent} />
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{silo.name}</span>
                        {silo.hubUrl && (
                            <a
                                href={silo.hubUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                            >
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        )}
                    </span>
                    {silo.description && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{silo.description}</span>
                    )}
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                    <span className="block font-medium text-foreground">{stats.totalRecords} record{stats.totalRecords === 1 ? '' : 's'}</span>
                    <span className="block tabular-nums">{stats.totalDemand.toLocaleString()} demand</span>
                </span>
            </button>

            {open && (
                <div className="border-t border-border p-2">
                    {topLevel.length === 0 && (
                        <p className="p-4 text-center text-sm text-muted-foreground">No records in this silo.</p>
                    )}
                    {topLevel.map(record => (
                        <div key={record.id}>
                            <RecordRow record={record} onClick={onSelectRecord} />
                            {childrenOf(record.id).map(child => (
                                <RecordRow key={child.id} record={child} isChild onClick={onSelectRecord} />
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
