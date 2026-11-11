'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
    CHANGE_TYPES,
    CHANGE_TYPE_LABEL,
    VERDICT_LABEL,
    type ChangeType,
    type Confounder,
    type ImpactModel,
    type SeoChange,
    type TimelineItem,
    type Verdict,
} from '@/lib/change-log/types';
import { formatDay, formatPt } from '@/lib/change-log/time';
import type { ChangeInput } from '@/lib/change-log/validate';

import { ChangeDetail } from './ChangeDetail';
import { ChangeForm } from './ChangeForm';

export type ChangeLogMode = 'list' | 'form' | 'detail' | 'loading' | 'empty' | 'setup';

function badgeClass(verdict: Verdict): string {
    if (verdict === 'improved') return 'bg-green-50 text-green-800 ring-green-600/20';
    if (verdict === 'declined') return 'bg-red-50 text-red-800 ring-red-600/20';
    if (verdict === 'flat') return 'bg-zinc-100 text-zinc-700 ring-zinc-500/20';
    return 'bg-amber-50 text-amber-900 ring-amber-600/20';
}

export function ChangeLogView({
    clientName,
    mode,
    example,
    exampleNote,
    items,
    detail,
    formInitial,
    formError,
    pending,
    revertOpen,
    onLog,
    onOpen,
    onBack,
    onSubmit,
    onRemove,
    onExample,
}: {
    clientName: string;
    mode: ChangeLogMode;
    example: boolean;
    exampleNote?: string;
    items: TimelineItem[];
    detail?: { change: SeoChange; impact: ImpactModel; confounders: Confounder[]; baselineNote: string | null } | null;
    formInitial?: ChangeInput;
    formError?: string | null;
    pending?: boolean;
    revertOpen?: boolean;
    onLog: () => void;
    onOpen: (id: string) => void;
    onBack: () => void;
    onSubmit: (input: ChangeInput) => void;
    onRemove: () => void;
    onExample?: () => void;
}) {
    const [pageQuery, setPageQuery] = useState('');
    const [type, setType] = useState<ChangeType | ''>('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const filtered = useMemo(() => items.filter(item => {
        if (type && item.changeType !== type) return false;
        if (from && item.liveOn < from) return false;
        if (to && item.liveOn > to) return false;
        if (pageQuery.trim()) {
            const needle = pageQuery.trim().toLowerCase();
            const hay = `${item.pageLabel} ${item.url} ${item.title}`.toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    }), [items, type, from, to, pageQuery]);

    return (
        <div className="change-log-root mx-auto max-w-6xl space-y-4">
            <style>{`
                .change-log-root .field {
                    width: 100%;
                    border-radius: 0.375rem;
                    border: 1px solid var(--border);
                    background: var(--card);
                    padding: 0.4rem 0.6rem;
                    font-size: 0.875rem;
                }
            `}</style>
            {example && exampleNote && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">{exampleNote}</p>
            )}
            {mode !== 'detail' && mode !== 'form' && (
                <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Changes</p>
                        <h1 className="text-2xl font-semibold tracking-tight">{clientName}</h1>
                        <p className="text-sm text-muted-foreground">Client: {clientName}</p>
                    </div>
                    {mode !== 'setup' && mode !== 'loading' && (
                        <Button type="button" onClick={onLog}>Log a change</Button>
                    )}
                </header>
            )}
            {mode === 'loading' && <LoadingState />}
            {mode === 'setup' && (
                <div className="rounded-lg border border-border bg-card p-6 text-sm">
                    <p className="font-medium">Change log isn&apos;t in the database yet.</p>
                    <p className="mt-1 text-muted-foreground">Migration 125 has to be applied first. Nothing here is saved until then.</p>
                    {onExample && <Button type="button" className="mt-4" variant="outline" onClick={onExample}>View example</Button>}
                </div>
            )}
            {mode === 'empty' && (
                <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
                    <p className="font-medium">No changes logged yet.</p>
                    <p className="mt-1 text-sm text-muted-foreground">Log an H1, title, or new page, then track it here.</p>
                    <Button type="button" className="mt-4" onClick={onLog}>Log a change</Button>
                </div>
            )}
            {mode === 'list' && (
                <>
                    <div className="grid gap-2 sm:grid-cols-4">
                        <input className="field" placeholder="Page or title" aria-label="Filter by page" value={pageQuery} onChange={event => setPageQuery(event.target.value)} />
                        <select className="field" aria-label="Change type" value={type} onChange={event => setType(event.target.value as ChangeType | '')}>
                            <option value="">All types</option>
                            {CHANGE_TYPES.map(item => <option key={item} value={item}>{CHANGE_TYPE_LABEL[item]}</option>)}
                        </select>
                        <input className="field" type="date" aria-label="From date" value={from} onChange={event => setFrom(event.target.value)} />
                        <input className="field" type="date" aria-label="To date" value={to} onChange={event => setTo(event.target.value)} />
                    </div>
                    {filtered.length === 0 ? (
                        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No changes match these filters.</p>
                    ) : (
                        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                            {filtered.map(item => (
                                <li key={item.id}>
                                    <button type="button" onClick={() => onOpen(item.id)} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between">
                                        <span>
                                            <span className="block text-sm font-medium">{item.title}</span>
                                            <span className="mt-0.5 block text-xs text-muted-foreground">
                                                {formatPt(item.liveAt)} · {CHANGE_TYPE_LABEL[item.changeType]} · {item.pageLabel}
                                            </span>
                                        </span>
                                        <span className="flex items-center gap-2">
                                            <span className="text-xs tabular-nums text-muted-foreground">{item.deltaText}</span>
                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeClass(item.verdict)}`}>
                                                {VERDICT_LABEL[item.verdict]}{item.estimate ? ' · Estimate' : ''}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ol>
                    )}
                    <p className="text-xs text-muted-foreground">Showing {filtered.length} of {items.length}. {formatDay(items[0]?.liveOn ?? '') && 'Newest first.'}</p>
                </>
            )}
            {mode === 'form' && (
                <div className="rounded-lg border border-border bg-card p-4">
                    {formError && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>}
                    <ChangeForm initial={formInitial} example={example} pending={pending === true} onCancel={onBack} onSubmit={onSubmit} />
                </div>
            )}
            {mode === 'detail' && detail && (
                <ChangeDetail
                    change={detail.change}
                    impact={detail.impact}
                    confounders={detail.confounders}
                    baselineNote={detail.baselineNote}
                    example={example}
                    revertInitiallyOpen={revertOpen}
                    onBack={onBack}
                    onOpen={onOpen}
                    onRemove={onRemove}
                />
            )}
        </div>
    );
}

function LoadingState() {
    return (
        <div className="space-y-3" aria-busy="true" aria-label="Loading changes">
            <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
        </div>
    );
}
