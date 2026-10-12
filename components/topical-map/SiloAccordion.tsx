'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SearchIntent, TopicalMapRecord, TopicalMapSilo } from '@/lib/types';
import { computeSiloStats } from '@/lib/topical-map/stats';
import { createManualRecord } from '@/lib/supabase/topical-map';
import type { ManualRecordDraft } from '@/lib/topical-map/spec';
import { AddRecordDialog } from './AddRecordDialog';
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
    specEnabled?: boolean;
    readOnly?: boolean;
    clientId?: string;
    onRecordCreated?: (record: TopicalMapRecord) => void;
}

export function SiloAccordion({
    silo, records, onSelectRecord, defaultOpen = true,
    specEnabled = false, readOnly = false, clientId, onRecordCreated,
}: SiloAccordionProps) {
    const [open, setOpen] = useState(defaultOpen);
    const [adding, setAdding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [addError, setAddError] = useState('');
    const stats = computeSiloStats(records, silo.id);
    const canAdd = specEnabled && !readOnly && Boolean(clientId);

    const siloRecords = sortRecords(records.filter(r => r.siloId === silo.id));
    const topLevel = siloRecords.filter(r => !r.parentRecordId);
    const childrenOf = (id: string) => sortRecords(siloRecords.filter(r => r.parentRecordId === id));

    const submitRecord = async (draft: ManualRecordDraft) => {
        if (!clientId) return;
        setSaving(true);
        setAddError('');
        const result = await createManualRecord({ ...draft, clientId, siloId: silo.id });
        setSaving(false);
        if (!result.record) {
            setAddError(result.error ?? 'Unable to add the record.');
            return;
        }
        setAdding(false);
        onRecordCreated?.(result.record);
    };

    return (
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-start gap-2 p-2">
            <button
                type="button"
                onClick={() => setOpen(current => !current)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', INTENT_COLOR[silo.searchIntent])} title={silo.searchIntent} />
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{silo.name}</span>
                    {silo.description && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{silo.description}</span>
                    )}
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                    <span className="block font-medium text-foreground">{stats.totalRecords} record{stats.totalRecords === 1 ? '' : 's'}</span>
                    <span className="block tabular-nums">{stats.totalDemand.toLocaleString()} demand</span>
                </span>
            </button>
            {silo.hubUrl && (
                <a
                    href={silo.hubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${silo.name} hub`}
                    className="mt-2 inline-flex shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <ExternalLink className="h-4 w-4" />
                </a>
            )}
            {canAdd && (
                <button
                    type="button"
                    aria-label={`Add record to ${silo.name}`}
                    onClick={() => { setAddError(''); setAdding(true); }}
                    className="mt-2 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add record
                </button>
            )}
            </div>

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
            {adding && (
                <AddRecordDialog
                    siloName={silo.name}
                    submitting={saving}
                    error={addError}
                    onClose={() => { if (!saving) setAdding(false); }}
                    onSubmit={draft => { void submitRecord(draft); }}
                />
            )}
        </section>
    );
}
