'use client';

import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
    MapRecordAction, PageType, TopicalMapRecord, TopicalMapSilo,
} from '@/lib/types';
import { approveRecord, declineRecord, updateRecord } from '@/lib/supabase/topical-map';

const PAGE_TYPES: PageType[] = [
    'pillar', 'service', 'landing', 'product', 'collection', 'city',
    'blog_post', 'guide', 'faq', 'resource_center', 'knowledge_base',
    'homepage', 'comparison', 'case_study', 'other',
];
const ACTIONS: MapRecordAction[] = ['create', 'replace', 'improve', 'keep'];

const inputClasses = 'mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm';

interface RecordDetailPanelProps {
    record: TopicalMapRecord | null;
    silos: TopicalMapSilo[];
    isOpen: boolean;
    onClose: () => void;
    onUpdated: (record: TopicalMapRecord) => void;
    organizationId: string;
    clientId: string;
    userId?: string;
}

export function RecordDetailPanel({
    record, silos, isOpen, onClose, onUpdated, organizationId, clientId, userId,
}: RecordDetailPanelProps) {
    const [draft, setDraft] = useState<TopicalMapRecord | null>(record);
    const [notesDraft, setNotesDraft] = useState('');
    const [isApproving, setIsApproving] = useState(false);
    const [isDeclining, setIsDeclining] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setDraft(record);
        setNotesDraft(record?.reviewerNotes ?? '');
        setError('');
    }, [record?.id]);

    if (!isOpen || !record || !draft) return null;

    const patch = async (p: Partial<TopicalMapRecord>) => {
        const next = { ...draft, ...p };
        setDraft(next);
        const res = await updateRecord(record.id, p);
        if (res.success) {
            onUpdated(next);
        } else {
            setError(res.error ?? 'Failed to save change');
        }
    };

    const handleApprove = async () => {
        setIsApproving(true);
        setError('');
        const res = await approveRecord(draft, organizationId, clientId, userId);
        setIsApproving(false);
        if (res.success) {
            onUpdated({ ...draft, status: 'approved', taskId: res.taskId });
            onClose();
        } else {
            setError(res.error ?? 'Failed to approve record');
        }
    };

    const handleDecline = async () => {
        setIsDeclining(true);
        setError('');
        const res = await declineRecord(record.id);
        setIsDeclining(false);
        if (res.success) {
            onUpdated({ ...draft, status: 'declined' });
            onClose();
        } else {
            setError(res.error ?? 'Failed to decline record');
        }
    };

    const numberField = (value: number | undefined) => (value === undefined ? '' : String(value));

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="h-full w-full max-w-md animate-in slide-in-from-right overflow-y-auto border-l border-border bg-card shadow-xl duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/50 bg-card p-4">
                    <div className="min-w-0 flex-1">
                        <input
                            value={draft.title}
                            onChange={e => setDraft({ ...draft, title: e.target.value })}
                            onBlur={() => draft.title !== record.title && patch({ title: draft.title })}
                            className="w-full truncate bg-transparent text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring rounded"
                        />
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Status: <span className="font-medium text-foreground">{draft.status}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-5 p-4">
                    {error && (
                        <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-500">{error}</p>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Silo</label>
                            <select
                                value={draft.siloId}
                                onChange={e => patch({ siloId: e.target.value })}
                                className={inputClasses}
                            >
                                {silos.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Page Type</label>
                            <select
                                value={draft.pageType}
                                onChange={e => patch({ pageType: e.target.value as PageType })}
                                className={inputClasses}
                            >
                                {PAGE_TYPES.map(pt => (
                                    <option key={pt} value={pt}>{pt.replaceAll('_', ' ')}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Action</label>
                            <select
                                value={draft.action}
                                onChange={e => patch({ action: e.target.value as MapRecordAction })}
                                className={inputClasses}
                            >
                                {ACTIONS.map(a => (
                                    <option key={a} value={a}>{a}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Category</label>
                            <input
                                value={draft.contentCategory ?? ''}
                                onChange={e => setDraft({ ...draft, contentCategory: e.target.value })}
                                onBlur={() => patch({ contentCategory: draft.contentCategory || undefined })}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Target Query</label>
                        <input
                            value={draft.targetQuery}
                            onChange={e => setDraft({ ...draft, targetQuery: e.target.value })}
                            onBlur={() => draft.targetQuery !== record.targetQuery && patch({ targetQuery: draft.targetQuery })}
                            className={inputClasses}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Word Count Min</label>
                            <input
                                type="number"
                                value={numberField(draft.wordCountMin)}
                                onChange={e => setDraft({ ...draft, wordCountMin: Number(e.target.value) })}
                                onBlur={() => patch({ wordCountMin: draft.wordCountMin })}
                                className={inputClasses}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Word Count Max</label>
                            <input
                                type="number"
                                value={numberField(draft.wordCountMax)}
                                onChange={e => setDraft({ ...draft, wordCountMax: Number(e.target.value) })}
                                onBlur={() => patch({ wordCountMax: draft.wordCountMax })}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Build Phase</label>
                            <input
                                type="number"
                                value={numberField(draft.buildPhase)}
                                onChange={e => setDraft({ ...draft, buildPhase: Number(e.target.value) })}
                                onBlur={() => patch({ buildPhase: draft.buildPhase })}
                                className={inputClasses}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Refresh (days)</label>
                            <input
                                type="number"
                                value={numberField(draft.refreshIntervalDays)}
                                onChange={e => setDraft({ ...draft, refreshIntervalDays: e.target.value ? Number(e.target.value) : undefined })}
                                onBlur={() => patch({ refreshIntervalDays: draft.refreshIntervalDays })}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Search Volume</label>
                            <input
                                type="number"
                                value={numberField(draft.searchVolumeMonthly)}
                                onChange={e => setDraft({ ...draft, searchVolumeMonthly: e.target.value ? Number(e.target.value) : undefined })}
                                onBlur={() => patch({ searchVolumeMonthly: draft.searchVolumeMonthly })}
                                className={inputClasses}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Keyword Difficulty</label>
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={numberField(draft.keywordDifficulty)}
                                onChange={e => setDraft({ ...draft, keywordDifficulty: e.target.value ? Number(e.target.value) : undefined })}
                                onBlur={() => patch({ keywordDifficulty: draft.keywordDifficulty })}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    {draft.sitePageId && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Matched Page</p>
                            <div className="mt-1.5 flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate font-mono text-xs">{draft.matchedUrl}</span>
                                {draft.matchedUrl && (
                                    <a
                                        href={draft.matchedUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="shrink-0 text-muted-foreground hover:text-primary"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                )}
                            </div>
                        </div>
                    )}

                    {draft.scopeExclusions.length > 0 && (
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Scope Exclusions</label>
                            <ul className="mt-1.5 space-y-1">
                                {draft.scopeExclusions.map((e, i) => (
                                    <li key={i} className="truncate rounded border border-border bg-muted/30 px-2 py-1 font-mono text-xs">
                                        {e.url}{e.reason ? ` — ${e.reason}` : ''}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {draft.outgoingLinks.length > 0 && (
                        <div>
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Outgoing Links</label>
                            <ul className="mt-1.5 space-y-1">
                                {draft.outgoingLinks.map((l, i) => (
                                    <li key={i} className="truncate rounded border border-border bg-muted/30 px-2 py-1 text-xs">
                                        {l.anchorText} → <span className="font-mono">{l.destinationUrl}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reviewer Notes</label>
                        <textarea
                            value={notesDraft}
                            onChange={e => setNotesDraft(e.target.value)}
                            onBlur={() => notesDraft !== (draft.reviewerNotes ?? '') && patch({ reviewerNotes: notesDraft || undefined })}
                            rows={3}
                            className={inputClasses}
                        />
                    </div>
                </div>

                <div className="sticky bottom-0 flex gap-2 border-t border-border/50 bg-card p-4">
                    <button
                        onClick={handleDecline}
                        disabled={isDeclining || isApproving || draft.status === 'declined'}
                        className={cn(
                            'flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50',
                            'border-red-500/30 text-red-500 hover:bg-red-500/10',
                        )}
                    >
                        {isDeclining ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        Decline
                    </button>
                    <button
                        onClick={handleApprove}
                        disabled={isApproving || isDeclining || draft.status === 'approved'}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                        {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Approve
                    </button>
                </div>
            </div>
        </div>
    );
}
