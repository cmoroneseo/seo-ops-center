'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
    MapRecordAction, MapRecordStatus, PageType, ProductionStatus, TopicalMapRecord, TopicalMapSilo,
} from '@/lib/types';
import { updateRecord, updateRecordSpec } from '@/lib/supabase/topical-map';
import { approveContentRecord, declineContentRecord, updateContentRecord } from '@/lib/content/client';
import { contentMonthChoices, currentWorkMonth } from '@/lib/content/board';
import { contentQuota, plannedAfterApproval } from '@/lib/content/quota';
import { ApproveForMonth } from '@/components/content/ApproveForMonth';
import { PAGE_TYPES, type SpecFieldPatch } from '@/lib/topical-map/spec';
import {
    canMarkAlreadyLive,
    cleanProductionPatch,
    displayedProductionStatus,
    draftAfterProductionSave,
    productionChoicePatch,
    PRODUCTION_STATUS_LABEL,
    PRODUCTION_STATUSES,
    PUBLISHED_NOTE,
    readHttpUrl,
    readWorkMonth,
    type MapProduction,
} from '@/lib/topical-map/production';
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
import { AI_ESTIMATE_LABEL, hasAiSearchEstimate } from '@/lib/topical-map/metrics';
import { ACTION_LABEL, PAGE_TYPE_LABEL, PILL_CLASS, PRODUCTION_STATUS_STYLES, SPEC_STATUS_STYLES } from './constants';
import { AnswerBriefSection } from './AnswerBriefSection';
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
    /** Viewers cannot approve a page or change its month, even when other fields stay open. */
    contentReadOnly?: boolean;
    contentPieces?: number | null;
    boardRecords?: TopicalMapRecord[];
    today?: string;
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
    record, silos, isOpen, onClose, onUpdated, clientId,
    specEnabled = false, readOnly = false, contentReadOnly = false,
    contentPieces = null, boardRecords = [], today,
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
    const todayMonth = readWorkMonth(today) ?? currentWorkMonth();
    const [approveMonth, setApproveMonth] = useState(todayMonth);
    const productionLocked = readOnly || contentReadOnly;
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
        setApproveMonth(readWorkMonth(record?.workMonth) ?? (readWorkMonth(today) ?? currentWorkMonth()));
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

    const productionStatus = displayedProductionStatus(draft);
    const productionChoices = PRODUCTION_STATUSES.filter(status => status !== 'already_live' || canMarkAlreadyLive(draft));
    const draftHref = readHttpUrl(draft.draftUrl);
    const liveHref = readHttpUrl(draft.liveUrl);
    const approveMonths = contentMonthChoices(todayMonth, [draft.workMonth]);
    const selectedMonth = approveMonths.includes(approveMonth) ? approveMonth : approveMonths[0] ?? approveMonth;
    const quota = contentQuota(plannedAfterApproval(boardRecords, draft.id, selectedMonth), contentPieces, selectedMonth);
    const approveLocked = productionLocked || isApproving || isDeclining || draft.status === 'approved';

    const patch = async (nextPatch: Partial<TopicalMapRecord>) => {
        const base = draftRef.current;
        if (!base) return;
        const next = { ...base, ...nextPatch };
        replaceDraft(next);
        const res = await updateRecord(base.id, nextPatch);
        if (res.success) onUpdatedRef.current(draftRef.current ?? next);
        else setError(res.error ?? 'Failed to save change');
    };

    const saveProduction = (partial: Partial<MapProduction> & { status?: MapRecordStatus }) => {
        const cleaned = cleanProductionPatch(partial);
        if (!cleaned.ok) {
            setError(cleaned.error);
            return;
        }
        const base = draftRef.current;
        if (!base) return;
        const nextPatch = {
            ...cleaned.value,
            ...(partial.status !== undefined ? { status: partial.status } : {}),
        };
        const optimistic = { ...base, ...nextPatch };
        replaceDraft(optimistic);
        setError('');
        void updateContentRecord({ clientId, recordId: base.id, ...cleaned.value }).then(res => {
            if (!draftRef.current || draftRef.current.id !== base.id) return;
            const saved = res.record;
            const settled = draftAfterProductionSave(base, saved ? { ...base, ...saved } : optimistic, Boolean(saved));
            replaceDraft(settled);
            if (saved) onUpdatedRef.current(settled);
            else setError(res.error ?? 'Could not save this page.');
        });
    };

    const saveSpec = async (specPatch: SpecFieldPatch) => {
        await persist(specPatch);
    };

    const handleApprove = async () => {
        if (productionLocked || !draft || draft.status === 'approved') return;
        const months = contentMonthChoices(todayMonth, [draft.workMonth]);
        const month = months.includes(approveMonth) ? approveMonth : months[0];
        if (!month) return;
        setIsApproving(true);
        setError('');
        const flushed = await flushPending();
        if (!flushed) {
            setIsApproving(false);
            return;
        }
        const current = draftRef.current ?? draft;
        const res = await approveContentRecord({
            clientId,
            recordId: current.id,
            workMonth: month,
        });
        setIsApproving(false);
        if (res.record) {
            onUpdatedRef.current(res.record);
            onClose();
        } else {
            setError(res.error ?? 'Could not approve this page.');
        }
    };

    const handleDecline = async () => {
        if (productionLocked) return;
        setIsDeclining(true);
        setError('');
        const flushed = await flushPending();
        if (!flushed) {
            setIsDeclining(false);
            return;
        }
        const res = await declineContentRecord({ clientId, recordId: record.id });
        setIsDeclining(false);
        if (res.record) {
            onUpdatedRef.current({ ...(draftRef.current ?? draft), ...res.record });
            onClose();
        } else {
            setError(res.error ?? 'Could not decline this page.');
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
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                                data-production-status={productionStatus}
                                title={productionStatus === 'published' ? PUBLISHED_NOTE : undefined}
                                className={cn(PILL_CLASS, PRODUCTION_STATUS_STYLES[productionStatus])}
                            >
                                {PRODUCTION_STATUS_LABEL[productionStatus]}
                            </span>
                            {specEnabled && draft.specStatus && (
                                <span className={cn(PILL_CLASS, SPEC_STATUS_STYLES[draft.specStatus])}>
                                    {draft.specStatus === 'draft' ? 'Draft' : 'Ready'}
                                </span>
                            )}
                        </div>
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
                            <label htmlFor="record-silo" className={labelClass}>Topic group</label>
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
                            <label htmlFor="record-page-type" className={labelClass}>Type of page</label>
                            <select
                                id="record-page-type"
                                value={draft.pageType}
                                disabled={readOnly}
                                onChange={event => patch({ pageType: event.target.value as PageType })}
                                className={inputClasses}
                            >
                                {PAGE_TYPES.map(pageType => (
                                    <option key={pageType} value={pageType}>{PAGE_TYPE_LABEL[pageType]}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="space-y-3 rounded-lg border border-border p-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="record-production-status" className={labelClass}>Status</label>
                                <select
                                    id="record-production-status"
                                    value={productionChoices.includes(productionStatus) ? productionStatus : productionChoices[0]}
                                    disabled={productionLocked}
                                    onChange={event => saveProduction(productionChoicePatch(event.target.value as ProductionStatus))}
                                    className={inputClasses}
                                >
                                    {productionChoices.map(status => (
                                        <option key={status} value={status}>{PRODUCTION_STATUS_LABEL[status]}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="record-work-month" className={labelClass}>Planned for</label>
                                <input
                                    id="record-work-month"
                                    type="month"
                                    value={draft.workMonth ?? ''}
                                    disabled={productionLocked}
                                    onChange={event => saveProduction({ workMonth: event.target.value || null })}
                                    className={inputClasses}
                                />
                            </div>
                            <div>
                                <label htmlFor="record-due-date" className={labelClass}>Due date</label>
                                <input
                                    id="record-due-date"
                                    type="date"
                                    value={draft.dueDate ?? ''}
                                    disabled={productionLocked}
                                    onChange={event => saveProduction({ dueDate: event.target.value || null })}
                                    className={inputClasses}
                                />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="record-published-on" className={labelClass}>Date published</label>
                            <input
                                id="record-published-on"
                                type="date"
                                value={draft.publishedOn ?? ''}
                                disabled={productionLocked}
                                onChange={event => saveProduction({ publishedOn: event.target.value || null })}
                                className={inputClasses}
                            />
                        </div>
                        <div>
                            <label htmlFor="record-draft-url" className={labelClass}>Draft link</label>
                            <input
                                id="record-draft-url"
                                type="url"
                                value={draft.draftUrl ?? ''}
                                placeholder="—"
                                disabled={productionLocked}
                                onChange={event => editDraft({ draftUrl: event.target.value })}
                                onBlur={event => {
                                    const value = event.currentTarget.value.trim();
                                    if (value === (record.draftUrl ?? '')) return;
                                    saveProduction({ draftUrl: value || null });
                                }}
                                className={inputClasses}
                            />
                            {draftHref && (
                                <a href={draftHref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                    Open draft <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                        <div>
                            <label htmlFor="record-live-url" className={labelClass}>Live link</label>
                            <input
                                id="record-live-url"
                                type="url"
                                value={draft.liveUrl ?? ''}
                                placeholder="—"
                                disabled={productionLocked}
                                onChange={event => editDraft({ liveUrl: event.target.value })}
                                onBlur={event => {
                                    const value = event.currentTarget.value.trim();
                                    if (value === (record.liveUrl ?? '')) return;
                                    saveProduction({ liveUrl: value || null });
                                }}
                                className={inputClasses}
                            />
                            {liveHref && (
                                <a href={liveHref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                    Open live page <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
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
                                    <option key={action} value={action}>{ACTION_LABEL[action]}</option>
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
                            <label htmlFor="record-query" className={labelClass}>Main search phrase</label>
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
                        <fieldset>
                            <legend className={labelClass}>Length (words)</legend>
                            <div className="grid grid-cols-2 gap-3">
                                <input
                                    id="record-words-min"
                                    aria-label="From"
                                    type="number"
                                    value={emptyCount(draft.wordCountMin)}
                                    placeholder="From"
                                    disabled={readOnly}
                                    onChange={event => editDraft({ wordCountMin: Number(event.target.value) })}
                                    onBlur={event => patch({ wordCountMin: Number(event.currentTarget.value) || 0 })}
                                    className={inputClasses}
                                />
                                <input
                                    id="record-words-max"
                                    aria-label="To"
                                    type="number"
                                    value={emptyCount(draft.wordCountMax)}
                                    placeholder="To"
                                    disabled={readOnly}
                                    onChange={event => editDraft({ wordCountMax: Number(event.target.value) })}
                                    onBlur={event => patch({ wordCountMax: Number(event.currentTarget.value) || 0 })}
                                    className={inputClasses}
                                />
                            </div>
                        </fieldset>
                    )}

                    {record.answerBrief && (
                        <AnswerBriefSection brief={record.answerBrief} answer={draft.answerFirst60} showAnswer={!specEnabled} />
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
                            <label htmlFor="record-volume" className={labelClass}>Monthly searches</label>
                            <input
                                id="record-volume"
                                type="number"
                                value={emptyCount(draft.searchVolumeMonthly)}
                                placeholder="—"
                                disabled={readOnly}
                                aria-describedby={hasAiSearchEstimate(draft) ? 'record-metrics-estimate' : undefined}
                                onChange={event => editDraft({ searchVolumeMonthly: event.target.value ? Number(event.target.value) : undefined })}
                                onBlur={event => {
                                    const raw = event.currentTarget.value;
                                    void patch({ searchVolumeMonthly: raw ? Number(raw) : undefined });
                                }}
                                className={inputClasses}
                            />
                        </div>
                        <div>
                            <label htmlFor="record-difficulty" className={labelClass}>How hard to rank</label>
                            <input
                                id="record-difficulty"
                                type="number"
                                min={0}
                                max={100}
                                value={numberField(draft.keywordDifficulty)}
                                placeholder="—"
                                disabled={readOnly}
                                aria-describedby={hasAiSearchEstimate(draft) ? 'record-metrics-estimate' : undefined}
                                onChange={event => editDraft({ keywordDifficulty: event.target.value ? Number(event.target.value) : undefined })}
                                onBlur={event => {
                                    const raw = event.currentTarget.value;
                                    void patch({ keywordDifficulty: raw ? Number(raw) : undefined });
                                }}
                                className={inputClasses}
                            />
                        </div>
                        {hasAiSearchEstimate(draft) && (
                            <p id="record-metrics-estimate" className="col-span-2 text-xs font-medium text-amber-600">
                                {AI_ESTIMATE_LABEL}
                            </p>
                        )}
                    </div>

                    {draft.sitePageId && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <p className={labelClass}>Existing page on the site</p>
                            <div className="mt-1.5 flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate font-mono text-xs">{draft.matchedUrl}</span>
                                {draft.matchedUrl && (
                                    <a
                                        href={draft.matchedUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="shrink-0 text-muted-foreground hover:text-primary"
                                        aria-label="Open the existing page"
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

                <div className="sticky bottom-0 space-y-3 border-t border-border/50 bg-card p-4">
                    <ApproveForMonth
                        month={selectedMonth}
                        months={approveMonths}
                        quota={quota}
                        disabled={approveLocked}
                        busy={isApproving}
                        onMonth={setApproveMonth}
                        onApprove={() => { void handleApprove(); }}
                    />
                    <button
                        type="button"
                        onClick={handleDecline}
                        disabled={productionLocked || isDeclining || isApproving || draft.status === 'declined'}
                        className={cn(
                            'inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                            'border-red-500/30 text-red-500 hover:bg-red-500/10',
                        )}
                    >
                        {isDeclining ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        Decline
                    </button>
                </div>
            </div>
        </div>
    );
}
