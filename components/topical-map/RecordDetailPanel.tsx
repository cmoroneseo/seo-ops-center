'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
    MapRecordAction, PageType, TopicalMapRecord, TopicalMapSilo,
} from '@/lib/types';
import { approveRecord, declineRecord, updateRecord, updateRecordSpec } from '@/lib/supabase/topical-map';
import { PAGE_TYPES, type SpecFieldPatch } from '@/lib/topical-map/spec';
import {
    advanceBaseline,
    bumpRevisions,
    changedSpecPatch,
    createSerialQueue,
    mergeSpecSave,
    pickSpecFields,
    snapshotRevisions,
    specBaseline,
    specPatchKey,
    specSaveLabel,
    type FieldRevisions,
    type SpecSaveState,
} from '@/lib/topical-map/spec-save';
import { PILL_CLASS, RECORD_STATUS_STYLES, SPEC_STATUS_STYLES } from './constants';
import { SpecSection } from './SpecSection';
import { useOverlayA11y } from './useOverlayA11y';

const ACTIONS: MapRecordAction[] = ['create', 'replace', 'improve', 'keep'];

const inputClasses = 'mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring';
const labelClass = 'text-xs font-medium uppercase tracking-wider text-muted-foreground';

interface RecordDetailPanelProps {
    record: TopicalMapRecord | null;
    silos: TopicalMapSilo[];
    isOpen: boolean;
    onClose: () => void;
    onUpdated: (record: TopicalMapRecord) => void;
    organizationId: string;
    clientId: string;
    userId?: string;
    specEnabled?: boolean;
    readOnly?: boolean;
}

function numberField(value: number | undefined): string {
    return value === undefined ? '' : String(value);
}

/** Word counts and search volume use 0 as "not set". Difficulty keeps a real 0. */
function emptyCount(value: number | undefined): string {
    if (value == null || value <= 0) return '';
    return String(value);
}

export function RecordDetailPanel({
    record, silos, isOpen, onClose, onUpdated, organizationId, clientId, userId,
    specEnabled = false, readOnly = false,
}: RecordDetailPanelProps) {
    const headingId = useId();
    const open = isOpen && Boolean(record);
    const closeRef = useRef<() => void>(onClose);
    const panelRef = useOverlayA11y(open, () => closeRef.current());
    const [draft, setDraft] = useState<TopicalMapRecord | null>(record);
    const [saved, setSaved] = useState<SpecFieldPatch>(() => record ? specBaseline(record) : {});
    const [notesDraft, setNotesDraft] = useState('');
    const [isApproving, setIsApproving] = useState(false);
    const [isDeclining, setIsDeclining] = useState(false);
    const [error, setError] = useState('');
    const [saveState, setSaveState] = useState<SpecSaveState>('idle');
    const draftRef = useRef<TopicalMapRecord | null>(record);
    const savedRef = useRef<SpecFieldPatch>(saved);
    const revisions = useRef<FieldRevisions>({});
    const pendingWrites = useRef(0);
    const saveFailed = useRef(false);
    const inflight = useRef(new Map<string, Promise<boolean>>());
    const enqueueRef = useRef(createSerialQueue());
    const onUpdatedRef = useRef(onUpdated);
    onUpdatedRef.current = onUpdated;

    const replaceDraft = (next: TopicalMapRecord) => {
        draftRef.current = next;
        setDraft(next);
    };

    const editDraft = (partial: Partial<TopicalMapRecord>) => {
        const base = draftRef.current;
        if (!base) return;
        const specky = pickSpecFields(partial);
        if (specky) revisions.current = bumpRevisions(revisions.current, specky);
        replaceDraft({ ...base, ...partial });
    };

    useEffect(() => {
        setDraft(record);
        draftRef.current = record;
        const baseline = record ? specBaseline(record) : {};
        savedRef.current = baseline;
        setSaved(baseline);
        revisions.current = {};
        setSaveState('idle');
        setNotesDraft(record?.reviewerNotes ?? '');
        setError('');
        // Reset only when a different page opens. Depending on `record` would
        // wipe an unsaved title when a spec save refreshes the same id.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record?.id]);

    const persist = (patch: SpecFieldPatch): Promise<boolean> => {
        if (!specEnabled || !record) return Promise.resolve(true);
        const meaningful = changedSpecPatch(patch, savedRef.current);
        if (!meaningful) return Promise.resolve(true);
        const key = specPatchKey(meaningful);
        const existing = inflight.current.get(key);
        if (existing) return existing;
        const sentRevisions = snapshotRevisions(revisions.current, meaningful);
        const recordId = record.id;
        pendingWrites.current += 1;
        setSaveState('saving');
        const job = enqueueRef.current(async () => {
            try {
                const res = await updateRecordSpec(clientId, recordId, meaningful);
                if (!res.record) {
                    saveFailed.current = true;
                    setError(res.error ?? 'Unable to save the spec.');
                    return false;
                }
                if (!draftRef.current || draftRef.current.id !== recordId) {
                    onUpdatedRef.current(res.record);
                    saveFailed.current = false;
                    return true;
                }
                const merged = mergeSpecSave(draftRef.current, res.record, meaningful, sentRevisions, revisions.current);
                const nextSaved = advanceBaseline(savedRef.current, merged, meaningful, sentRevisions, revisions.current);
                savedRef.current = nextSaved;
                setSaved(nextSaved);
                replaceDraft(merged);
                onUpdatedRef.current(merged);
                saveFailed.current = false;
                setError('');
                return true;
            } catch {
                saveFailed.current = true;
                setError('Unable to save the spec.');
                return false;
            }
        });
        inflight.current.set(key, job);
        void job.finally(() => {
            if (inflight.current.get(key) === job) inflight.current.delete(key);
            pendingWrites.current = Math.max(0, pendingWrites.current - 1);
            if (pendingWrites.current === 0) {
                const dirty = draftRef.current ? changedSpecPatch(specBaseline(draftRef.current), savedRef.current) : null;
                setSaveState(saveFailed.current ? 'error' : dirty ? 'idle' : 'saved');
            }
        });
        return job;
    };

    const flushPending = async (): Promise<boolean> => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && panelRef.current?.contains(active)) active.blur();
        if (!specEnabled) return true;
        const current = draftRef.current;
        if (!current) return true;
        const pending = changedSpecPatch(specBaseline(current), savedRef.current);
        if (!pending) return true;
        return persist(pending);
    };

    closeRef.current = () => { void requestClose(); };

    async function requestClose() {
        const ok = await flushPending();
        if (ok) onClose();
    }

    if (!open || !record || !draft) return null;

    const patch = async (nextPatch: Partial<TopicalMapRecord>) => {
        const base = draftRef.current;
        if (!base) return;
        const next = { ...base, ...nextPatch };
        replaceDraft(next);
        const res = await updateRecord(base.id, nextPatch);
        if (res.success) onUpdatedRef.current(draftRef.current ?? next);
        else setError(res.error ?? 'Failed to save change');
    };

    const saveSpec = async (specPatch: SpecFieldPatch) => {
        await persist(specPatch);
    };

    const handleApprove = async () => {
        setIsApproving(true);
        setError('');
        const flushed = await flushPending();
        if (!flushed) {
            setIsApproving(false);
            return;
        }
        const current = draftRef.current ?? draft;
        const res = await approveRecord(current, organizationId, clientId, userId);
        setIsApproving(false);
        if (res.success) {
            onUpdatedRef.current({ ...current, status: 'approved', taskId: res.taskId });
            onClose();
        } else {
            setError(res.error ?? 'Failed to approve record');
        }
    };

    const handleDecline = async () => {
        setIsDeclining(true);
        setError('');
        const flushed = await flushPending();
        if (!flushed) {
            setIsDeclining(false);
            return;
        }
        const res = await declineRecord(record.id);
        setIsDeclining(false);
        if (res.success) {
            onUpdatedRef.current({ ...(draftRef.current ?? draft), status: 'declined' });
            onClose();
        } else {
            setError(res.error ?? 'Failed to decline record');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={() => { void requestClose(); }}>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={headingId}
                className={cn(
                    'h-full w-full animate-in slide-in-from-right overflow-y-auto border-l border-border bg-card shadow-xl duration-200',
                    specEnabled ? 'max-w-xl' : 'max-w-md',
                )}
                onClick={event => event.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/50 bg-card p-4">
                    <div className="min-w-0 flex-1">
                        <h2 id={headingId} className="sr-only">{specEnabled ? 'Page spec' : 'Record details'}</h2>
                        <input
                            aria-label="Page title"
                            data-autofocus="true"
                            value={draft.title}
                            disabled={readOnly}
                            onChange={event => editDraft({ title: event.target.value })}
                            onBlur={event => event.currentTarget.value !== record.title && patch({ title: event.currentTarget.value })}
                            className="w-full truncate bg-transparent text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring rounded"
                        />
                        {specEnabled ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={cn(PILL_CLASS, 'uppercase', RECORD_STATUS_STYLES[draft.status])}>{draft.status}</span>
                                {draft.specStatus ? (
                                    <span className={cn(PILL_CLASS, SPEC_STATUS_STYLES[draft.specStatus])}>
                                        {draft.specStatus === 'draft' ? 'Draft' : 'Ready'}
                                    </span>
                                ) : (
                                    <span className="text-xs text-muted-foreground">Spec —</span>
                                )}
                            </div>
                        ) : (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                Status: <span className="font-medium text-foreground">{draft.status}</span>
                            </p>
                        )}
                    </div>
                    <button type="button" onClick={() => { void requestClose(); }} aria-label="Close record" className="shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="space-y-5 p-4">
                    {error && (
                        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-500">{error}</p>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="record-silo" className={labelClass}>Silo</label>
                            <select
                                id="record-silo"
                                value={draft.siloId}
                                disabled={readOnly}
                                onChange={event => patch({ siloId: event.target.value })}
                                className={inputClasses}
                            >
                                {silos.map(silo => (
                                    <option key={silo.id} value={silo.id}>{silo.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="record-page-type" className={labelClass}>Page Type</label>
                            <select
                                id="record-page-type"
                                value={draft.pageType}
                                disabled={readOnly}
                                onChange={event => patch({ pageType: event.target.value as PageType })}
                                className={inputClasses}
                            >
                                {PAGE_TYPES.map(pageType => (
                                    <option key={pageType} value={pageType}>{pageType.replaceAll('_', ' ')}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="record-action" className={labelClass}>Action</label>
                            <select
                                id="record-action"
                                value={draft.action}
                                disabled={readOnly}
                                onChange={event => patch({ action: event.target.value as MapRecordAction })}
                                className={inputClasses}
                            >
                                {ACTIONS.map(action => (
                                    <option key={action} value={action}>{action}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="record-category" className={labelClass}>Category</label>
                            <input
                                id="record-category"
                                value={draft.contentCategory ?? ''}
                                disabled={readOnly}
                                placeholder="—"
                                onChange={event => editDraft({ contentCategory: event.target.value })}
                                onBlur={event => patch({ contentCategory: event.currentTarget.value || undefined })}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    {!specEnabled && (
                        <div>
                            <label htmlFor="record-query" className={labelClass}>Target Query</label>
                            <input
                                id="record-query"
                                value={draft.targetQuery}
                                disabled={readOnly}
                                placeholder="—"
                                onChange={event => editDraft({ targetQuery: event.target.value })}
                                onBlur={event => event.currentTarget.value !== record.targetQuery && patch({ targetQuery: event.currentTarget.value })}
                                className={inputClasses}
                            />
                        </div>
                    )}

                    {!specEnabled && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="record-words-min" className={labelClass}>Word Count Min</label>
                                <input
                                    id="record-words-min"
                                    type="number"
                                    value={emptyCount(draft.wordCountMin)}
                                    placeholder="—"
                                    disabled={readOnly}
                                    onChange={event => editDraft({ wordCountMin: Number(event.target.value) })}
                                    onBlur={event => patch({ wordCountMin: Number(event.currentTarget.value) || 0 })}
                                    className={inputClasses}
                                />
                            </div>
                            <div>
                                <label htmlFor="record-words-max" className={labelClass}>Word Count Max</label>
                                <input
                                    id="record-words-max"
                                    type="number"
                                    value={emptyCount(draft.wordCountMax)}
                                    placeholder="—"
                                    disabled={readOnly}
                                    onChange={event => editDraft({ wordCountMax: Number(event.target.value) })}
                                    onBlur={event => patch({ wordCountMax: Number(event.currentTarget.value) || 0 })}
                                    className={inputClasses}
                                />
                            </div>
                        </div>
                    )}

                    {specEnabled && (
                        <SpecSection
                            key={record.id}
                            draft={draft}
                            saved={saved}
                            readOnly={readOnly}
                            saveLabel={specSaveLabel(saveState)}
                            onDraft={editDraft}
                            onSave={saveSpec}
                        />
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="record-phase" className={labelClass}>Build Phase</label>
                            <input
                                id="record-phase"
                                type="number"
                                value={numberField(draft.buildPhase)}
                                disabled={readOnly}
                                onChange={event => editDraft({ buildPhase: Number(event.target.value) })}
                                onBlur={event => patch({ buildPhase: Number(event.currentTarget.value) || draft.buildPhase })}
                                className={inputClasses}
                            />
                        </div>
                        <div>
                            <label htmlFor="record-refresh" className={labelClass}>Refresh (days)</label>
                            <input
                                id="record-refresh"
                                type="number"
                                value={emptyCount(draft.refreshIntervalDays)}
                                placeholder="—"
                                disabled={readOnly}
                                onChange={event => editDraft({ refreshIntervalDays: event.target.value ? Number(event.target.value) : undefined })}
                                onBlur={event => {
                                    const raw = event.currentTarget.value;
                                    void patch({ refreshIntervalDays: raw ? Number(raw) : undefined });
                                }}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="record-volume" className={labelClass}>Search Volume</label>
                            <input
                                id="record-volume"
                                type="number"
                                value={emptyCount(draft.searchVolumeMonthly)}
                                placeholder="—"
                                disabled={readOnly}
                                onChange={event => editDraft({ searchVolumeMonthly: event.target.value ? Number(event.target.value) : undefined })}
                                onBlur={event => {
                                    const raw = event.currentTarget.value;
                                    void patch({ searchVolumeMonthly: raw ? Number(raw) : undefined });
                                }}
                                className={inputClasses}
                            />
                        </div>
                        <div>
                            <label htmlFor="record-difficulty" className={labelClass}>Keyword Difficulty</label>
                            <input
                                id="record-difficulty"
                                type="number"
                                min={0}
                                max={100}
                                value={numberField(draft.keywordDifficulty)}
                                placeholder="—"
                                disabled={readOnly}
                                onChange={event => editDraft({ keywordDifficulty: event.target.value ? Number(event.target.value) : undefined })}
                                onBlur={event => {
                                    const raw = event.currentTarget.value;
                                    void patch({ keywordDifficulty: raw ? Number(raw) : undefined });
                                }}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    {draft.sitePageId && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <p className={labelClass}>Matched Page</p>
                            <div className="mt-1.5 flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate font-mono text-xs">{draft.matchedUrl}</span>
                                {draft.matchedUrl && (
                                    <a
                                        href={draft.matchedUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="shrink-0 text-muted-foreground hover:text-primary"
                                        aria-label="Open matched page"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                )}
                            </div>
                        </div>
                    )}

                    {!specEnabled && draft.scopeExclusions.length > 0 && (
                        <div>
                            <p className={labelClass}>Scope Exclusions</p>
                            <ul className="mt-1.5 space-y-1">
                                {draft.scopeExclusions.map((item, index) => (
                                    <li key={index} className="truncate rounded border border-border bg-muted/30 px-2 py-1 font-mono text-xs">
                                        {item.url}{item.reason ? ` — ${item.reason}` : ''}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {!specEnabled && draft.outgoingLinks.length > 0 && (
                        <div>
                            <p className={labelClass}>Outgoing Links</p>
                            <ul className="mt-1.5 space-y-1">
                                {draft.outgoingLinks.map((link, index) => (
                                    <li key={index} className="truncate rounded border border-border bg-muted/30 px-2 py-1 text-xs">
                                        {link.anchorText} → <span className="font-mono">{link.destinationUrl}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div>
                        <label htmlFor="record-notes" className={labelClass}>Reviewer Notes</label>
                        <textarea
                            id="record-notes"
                            value={notesDraft}
                            placeholder="—"
                            disabled={readOnly}
                            onChange={event => setNotesDraft(event.target.value)}
                            onBlur={event => {
                                const value = event.currentTarget.value;
                                if (value !== (draft.reviewerNotes ?? '')) void patch({ reviewerNotes: value || undefined });
                            }}
                            rows={3}
                            className={inputClasses}
                        />
                    </div>
                </div>

                <div className="sticky bottom-0 flex gap-2 border-t border-border/50 bg-card p-4">
                    <button
                        type="button"
                        onClick={handleDecline}
                        disabled={isDeclining || isApproving || draft.status === 'declined'}
                        className={cn(
                            'flex-1 inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                            'border-red-500/30 text-red-500 hover:bg-red-500/10',
                        )}
                    >
                        {isDeclining ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        Decline
                    </button>
                    <button
                        type="button"
                        onClick={handleApprove}
                        disabled={isApproving || isDeclining || draft.status === 'approved'}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                        {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Approve
                    </button>
                </div>
            </div>
        </div>
    );
}
