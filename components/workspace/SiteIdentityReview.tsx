'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ExternalLink,
    FileQuestion,
    History,
    Loader2,
    RefreshCw,
    RotateCcw,
    Split,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { reasonCodesFor, validateIdentityReason } from '@/lib/site-inventory/identity';
import { processIdentityDecisionResponse } from '@/lib/site-inventory/identity-client';
import {
    identityDecisionFormReducer,
    initialIdentityDecisionFormState,
} from '@/lib/site-inventory/identity-review-form';
import { claimDirectionForCandidate, identityViewState } from '@/lib/site-inventory/identity-view';
import type {
    SiteIdentityCandidate,
    SiteIdentityDecisionKind,
    SiteIdentityPageEvidence,
    SiteIdentityReasonCode,
    SiteIdentityReviewPayload,
} from '@/lib/types';

const reasonLabels: Record<SiteIdentityReasonCode, string> = {
    redirect_alias: 'Reviewer confirmed redirect alias',
    canonical_alias: 'Reviewer confirmed canonical alias',
    protocol_or_host_variant: 'Reviewer confirmed protocol or host variant',
    duplicate_page: 'Reviewer determined these are the same page',
    historical_url: 'Reviewer confirmed historical URL',
    distinct_intent: 'Reviewer confirmed distinct intent',
    distinct_location: 'Reviewer confirmed distinct location',
    distinct_language: 'Reviewer confirmed distinct language',
    intentional_variant: 'Reviewer confirmed intentional variant',
    different_content: 'Reviewer confirmed different content',
    content_purpose_unknown: 'Content purpose is not yet known',
    conflicting_signals: 'Observed signals conflict',
    target_unfetched: 'Observed target was not fetched',
    ownership_unknown: 'Target ownership is not yet known',
    incorrect_decision: 'Earlier reviewer decision was incorrect',
    new_evidence: 'New evidence is available',
    site_changed: 'The site changed after review',
    other: 'Other reviewer reason',
};

const decisionLabels: Record<SiteIdentityDecisionKind, string> = {
    claim_into: 'Claim into target',
    keep_separate: 'Keep separate',
    needs_research: 'Needs research',
    reopen: 'Reopen claim',
};

function displayDate(value?: string) {
    return value ? new Date(value).toLocaleString() : 'Not observed';
}

function EvidenceCard({
    evidence,
    label,
    signals,
}: {
    evidence: SiteIdentityPageEvidence;
    label: string;
    signals?: SiteIdentityCandidate['signals'];
}) {
    const content = <>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>
                <p className="mt-1 truncate text-sm font-medium">{evidence.title || 'No title observed'}</p>
            </div>
            <a
                href={evidence.primaryUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Open ${label.toLowerCase()} primary URL`}
                onClick={event => event.stopPropagation()}
            >
                <ExternalLink className="h-3.5 w-3.5" />
            </a>
        </div>
        <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{evidence.primaryUrl}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div><dt className="text-muted-foreground">HTTP</dt><dd className="mt-0.5 font-medium">{evidence.statusCode ?? 'Not available'}</dd></div>
            <div><dt className="text-muted-foreground">Fetch</dt><dd className="mt-0.5 font-medium">{evidence.fetchStatus?.replaceAll('_', ' ') ?? 'Not fetched'}</dd></div>
            <div className="col-span-2"><dt className="text-muted-foreground">Observed</dt><dd className="mt-0.5 font-medium">{displayDate(evidence.observedAt)}</dd></div>
            <div className="col-span-2"><dt className="text-muted-foreground">Canonical URL</dt><dd className="mt-0.5 break-all font-mono">{evidence.canonicalUrl ?? 'Not observed'}</dd></div>
        </dl>
        {signals && signals.length > 0 && <div className="mt-3 border-t border-border pt-3 text-[11px]">
            <p className="font-medium">Exact observed signal{signals.length === 1 ? '' : 's'}</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
                {signals.map((signal, index) => <li key={`${signal.kind}-${signal.url}-${index}`} className="break-all"><span className="font-medium text-foreground">{signal.kind}</span> · {signal.url}</li>)}
            </ul>
        </div>}
        <div className="mt-3 border-t border-border pt-3 text-[11px]">
            <p className="text-muted-foreground">Evidence limitations</p>
            <p className="mt-1">{evidence.limitationFlags.length > 0 ? evidence.limitationFlags.map(flag => flag.replaceAll('_', ' ')).join(' · ') : 'No limitation flag stored for this snapshot.'}</p>
        </div>
    </>;

    return <div className="min-w-0 rounded-xl border border-border bg-background p-3">{content}</div>;
}

export function SiteIdentityReview({
    clientId,
    pageId,
    snapshotId,
}: {
    clientId: string;
    pageId: string;
    snapshotId: string;
}) {
    const [payload, setPayload] = useState<SiteIdentityReviewPayload>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [conflictNotice, setConflictNotice] = useState('');
    const [saving, setSaving] = useState(false);
    const [form, dispatchForm] = useReducer(
        identityDecisionFormReducer,
        initialIdentityDecisionFormState,
    );
    const {
        confirmOpen,
        selectedCandidateId,
        decisionKind,
        reasonCode,
        note,
        saveError,
    } = form;
    const savingRef = useRef(false);

    const loadReview = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        try {
            const response = await fetch(`/api/site-inventory/identity?clientId=${encodeURIComponent(clientId)}&pageId=${encodeURIComponent(pageId)}`, {
                cache: 'no-store',
                signal,
            });
            const body = await response.json().catch(() => ({})) as SiteIdentityReviewPayload & { error?: string };
            if (!response.ok) throw new Error(body.error || 'Unable to load the site identity review.');
            setPayload(body);
            setError('');
            return true;
        } catch (reason) {
            if (reason instanceof DOMException && reason.name === 'AbortError') return false;
            setError(reason instanceof Error ? reason.message : 'Unable to load the site identity review.');
            return false;
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [clientId, pageId]);

    useEffect(() => {
        const controller = new AbortController();
        void loadReview(controller.signal);
        return () => controller.abort();
    }, [loadReview]);

    useEffect(() => {
        const firstCandidate = payload?.candidates.find(candidate => (
            candidate.page.snapshotId && claimDirectionForCandidate(candidate)
        ))
            ?? payload?.candidates[0];
        dispatchForm({ type: 'select_candidate', candidateId: firstCandidate?.page.pageId ?? '' });
    }, [payload]);

    const view = identityViewState(payload, { loading, error, selectedSnapshotId: snapshotId });
    const selectedCandidate = payload?.candidates.find(candidate => candidate.page.pageId === selectedCandidateId);
    const selectedClaimDirection = selectedCandidate
        ? claimDirectionForCandidate(selectedCandidate)
        : undefined;
    const currentDecisionKind: SiteIdentityDecisionKind | undefined = view.reviewState === 'active_claim'
        ? 'reopen'
        : decisionKind;
    const reasonError = currentDecisionKind && reasonCode
        ? validateIdentityReason(currentDecisionKind, reasonCode, note)
        : 'Select a reason before continuing.';
    const actionAllowed = currentDecisionKind === 'claim_into'
        ? view.canClaim && Boolean(selectedCandidate?.page.snapshotId) && Boolean(selectedClaimDirection)
        : currentDecisionKind === 'keep_separate'
            ? view.canKeepSeparate
            : currentDecisionKind === 'needs_research'
                ? view.canMarkNeedsResearch
                : currentDecisionKind === 'reopen'
                    ? view.canReopen
                    : false;
    const canSubmit = actionAllowed && !reasonError && !saving;
    const reasonOptions = currentDecisionKind ? reasonCodesFor(currentDecisionKind) : [];
    const activeCandidate = payload?.activeClaim
        ? payload.candidates.find(candidate => candidate.page.pageId === payload.activeClaim?.targetPageId)
        : undefined;
    const activeClaimDirection = activeCandidate
        ? claimDirectionForCandidate(activeCandidate)
        : undefined;

    const chooseDecision = (kind: Exclude<SiteIdentityDecisionKind, 'reopen'>) => {
        dispatchForm({ type: 'choose_decision', decisionKind: kind });
        setConflictNotice('');
    };

    const saveDecision = async () => {
        if (!payload || !currentDecisionKind || !reasonCode || !canSubmit || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        dispatchForm({ type: 'set_save_error', message: '' });
        setConflictNotice('');
        try {
            const response = await fetch('/api/site-inventory/identity/decisions', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    clientId,
                    pageId,
                    decisionKind: currentDecisionKind,
                    reasonCode,
                    ...(note.trim() ? { note: note.trim() } : {}),
                    expectedSourceSnapshotId: payload.source.snapshotId,
                    ...(currentDecisionKind === 'claim_into' && selectedCandidate ? {
                        targetPageId: selectedCandidate.page.pageId,
                        expectedTargetSnapshotId: selectedCandidate.page.snapshotId,
                    } : {}),
                    ...(currentDecisionKind === 'reopen' && activeCandidate?.page.snapshotId ? {
                        expectedTargetSnapshotId: activeCandidate.page.snapshotId,
                    } : {}),
                }),
            });
            const result = await processIdentityDecisionResponse(response, {
                invalidateConflict() {
                    dispatchForm({ type: 'conflict_reset' });
                },
                refresh: loadReview,
            });
            if (result.kind === 'failed') {
                dispatchForm({ type: 'set_save_error', message: result.message });
                return;
            }
            if (result.kind === 'conflict_refreshed') {
                setConflictNotice(result.message);
                return;
            }
            if (result.kind === 'conflict_refresh_failed') {
                setConflictNotice('');
                return;
            }
            dispatchForm({ type: 'saved_reset' });
        } catch (reason) {
            dispatchForm({
                type: 'set_save_error',
                message: reason instanceof Error ? reason.message : 'Unable to save the site identity decision.',
            });
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const confirmationDescription = useMemo(() => {
        if (!payload || !currentDecisionKind) return '';
        if (currentDecisionKind === 'claim_into' && selectedClaimDirection) {
            return `Confirm the reviewer claim from ${payload.source.primaryUrl} into immediate target ${selectedClaimDirection.immediateTargetUrl}. That target currently resolves to the surviving primary URL ${selectedClaimDirection.survivingPrimaryUrl}. This records a reviewer decision and does not change crawl evidence or site behavior.`;
        }
        if (currentDecisionKind === 'reopen') {
            const immediateTarget = activeClaimDirection?.immediateTargetUrl
                ?? view.activeTargetPrimaryUrl
                ?? payload.activeClaim?.targetPageId
                ?? 'the recorded target';
            const survivingTarget = activeClaimDirection?.survivingPrimaryUrl ?? immediateTarget;
            return `Confirm reopening the active source claim from ${payload.source.primaryUrl} into immediate target ${immediateTarget}, currently resolving to surviving primary URL ${survivingTarget}. Crawl evidence and reviewer history remain unchanged.`;
        }
        if (currentDecisionKind === 'keep_separate') {
            return `Confirm the reviewer decision to keep ${payload.source.primaryUrl} and ${selectedCandidate?.page.primaryUrl ?? 'the observed target'} as separate page identities.`;
        }
        return `Confirm that ${payload.source.primaryUrl} needs further identity research. This records reviewer judgment without creating a page claim.`;
    }, [activeClaimDirection, currentDecisionKind, payload, selectedCandidate, selectedClaimDirection, view.activeTargetPrimaryUrl]);

    return <section className="mt-5 border-t border-border pt-5" aria-labelledby="identity-review-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Reviewer identity layer</p>
                <h4 id="identity-review-title" className="mt-1 font-semibold">Page identity review</h4>
            </div>
            <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground">{view.statusLabel}</span>
        </div>

        <div className={`mt-3 rounded-xl border p-3 text-xs ${view.evidenceState === 'read_failure' || view.evidenceState === 'stale_evidence' ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-muted/20'}`} role={view.evidenceState === 'read_failure' ? 'alert' : 'status'}>
            <div className="flex items-start gap-2">
                {loading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" /> : view.evidenceState === 'exact_candidate' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : view.evidenceState === 'unmatched_signal' ? <FileQuestion className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                <div><p className="font-medium">{view.title}</p><p className="mt-1 text-muted-foreground">{view.summary}</p><p className="mt-1 text-muted-foreground">{view.notice}</p></div>
            </div>
            {view.evidenceState === 'read_failure' && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void loadReview()} disabled={loading}><RefreshCw />Retry identity review</Button>}
        </div>

        {conflictNotice && !error && <div role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="font-medium">Review state refreshed</p><p className="mt-1 text-muted-foreground">{conflictNotice}</p></div></div>}

        {payload && <>
            <div
                className="mt-4 grid gap-3"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))' }}
            >
                <EvidenceCard evidence={payload.source} label="Selected source" />
                {selectedCandidate && <EvidenceCard
                    evidence={selectedCandidate.page}
                    label="Immediate exact target"
                    signals={selectedCandidate.signals}
                />}
                {selectedClaimDirection?.chained && selectedCandidate?.resolvedPage && <EvidenceCard
                    evidence={selectedCandidate.resolvedPage}
                    label="Surviving primary page"
                />}
            </div>

            {selectedClaimDirection && <dl className="mt-3 grid gap-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
                <div><dt className="font-medium">Immediate target</dt><dd className="mt-1 break-all font-mono text-muted-foreground">{selectedClaimDirection.immediateTargetUrl}</dd></div>
                <div><dt className="font-medium">Surviving primary URL</dt><dd className="mt-1 break-all font-mono text-muted-foreground">{selectedClaimDirection.survivingPrimaryUrl}</dd></div>
            </dl>}

            {payload.candidates.length > 1 && <fieldset className="mt-3">
                <legend className="text-[11px] font-medium">Exact candidate pages</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                    {payload.candidates.map((candidate, index) => <button
                        key={candidate.page.pageId}
                        type="button"
                        aria-pressed={candidate.page.pageId === selectedCandidate?.page.pageId}
                        aria-label={`View candidate ${index + 1}: ${candidate.page.primaryUrl}`}
                        onClick={() => dispatchForm({ type: 'select_candidate', candidateId: candidate.page.pageId })}
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${candidate.page.pageId === selectedCandidate?.page.pageId ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                    >Candidate {index + 1}</button>)}
                </div>
            </fieldset>}

            {payload.unmatchedSignals.length > 0 && <div className="mt-3 rounded-xl border border-dashed border-border p-3 text-[11px]">
                <p className="font-medium">Unmatched observed target{payload.unmatchedSignals.length === 1 ? '' : 's'}</p>
                <ul className="mt-2 space-y-1 text-muted-foreground">{payload.unmatchedSignals.map((signal, index) => <li key={`${signal.kind}-${signal.url}-${index}`} className="break-all"><span className="font-medium text-foreground">{signal.kind}</span> · {signal.url}</li>)}</ul>
            </div>}

            {view.reviewState === 'active_claim' && payload.activeClaim && <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
                <div className="flex items-start gap-2"><ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="font-medium">Active reviewer claim</p><p className="mt-1 break-all text-muted-foreground">{payload.source.primaryUrl} → {activeClaimDirection?.immediateTargetUrl ?? view.activeTargetPrimaryUrl ?? payload.activeClaim.targetPageId}{activeClaimDirection?.chained ? ` → ${activeClaimDirection.survivingPrimaryUrl}` : ''}</p></div></div>
            </div>}

            {(view.canClaim || view.canKeepSeparate || view.canMarkNeedsResearch || view.canReopen) && <div className="mt-4 rounded-xl border border-border bg-background p-3">
                {view.canReopen ? <div className="flex items-center gap-2 text-xs font-medium"><RotateCcw className="h-4 w-4 text-primary" />Reopen active source claim</div> : <fieldset>
                    <legend className="text-xs font-medium">Reviewer decision</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {view.canClaim && <button type="button" aria-pressed={decisionKind === 'claim_into'} onClick={() => chooseDecision('claim_into')} className={`min-w-24 flex-1 rounded-lg border p-2 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${decisionKind === 'claim_into' ? 'border-primary bg-primary/5' : 'border-border'}`}><ArrowRight className="mb-1 h-4 w-4" />Claim into target</button>}
                        {view.canKeepSeparate && <button type="button" aria-pressed={decisionKind === 'keep_separate'} onClick={() => chooseDecision('keep_separate')} className={`min-w-24 flex-1 rounded-lg border p-2 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${decisionKind === 'keep_separate' ? 'border-primary bg-primary/5' : 'border-border'}`}><Split className="mb-1 h-4 w-4" />Keep separate</button>}
                        {view.canMarkNeedsResearch && <button type="button" aria-pressed={decisionKind === 'needs_research'} onClick={() => chooseDecision('needs_research')} className={`min-w-24 flex-1 rounded-lg border p-2 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${decisionKind === 'needs_research' ? 'border-primary bg-primary/5' : 'border-border'}`}><FileQuestion className="mb-1 h-4 w-4" />Needs research</button>}
                    </div>
                </fieldset>}

                {currentDecisionKind && <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <label className="block text-[11px] font-medium" htmlFor={`identity-reason-${pageId}`}>Structured reason</label>
                    <select
                        id={`identity-reason-${pageId}`}
                        value={reasonCode}
                        onChange={event => dispatchForm({ type: 'set_reason', reasonCode: event.target.value as SiteIdentityReasonCode | '' })}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    >
                        <option value="">Select a reviewer reason</option>
                        {reasonOptions.map(code => <option key={code} value={code}>{reasonLabels[code]}</option>)}
                    </select>
                    <label className="block text-[11px] font-medium" htmlFor={`identity-note-${pageId}`}>Reviewer note <span className="font-normal text-muted-foreground">{reasonCode === 'other' ? '(required)' : '(optional)'}</span></label>
                    <textarea
                        id={`identity-note-${pageId}`}
                        value={note}
                        onChange={event => dispatchForm({ type: 'set_note', note: event.target.value })}
                        maxLength={2000}
                        rows={3}
                        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        placeholder="Record reviewer context without changing crawl facts."
                    />
                    {reasonCode === 'other' && reasonError && <p className="text-[11px] text-red-500" role="alert">{reasonError}</p>}
                    {saveError && <p className="flex items-start gap-2 text-[11px] text-red-500" role="alert"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{saveError}</p>}
                    <Button type="button" size="sm" onClick={() => dispatchForm({ type: 'set_confirmation', open: true })} disabled={!canSubmit} className="w-full">
                        {saving ? <Loader2 className="animate-spin" /> : currentDecisionKind === 'reopen' ? <RotateCcw /> : <CheckCircle2 />}
                        Review {decisionLabels[currentDecisionKind].toLowerCase()}
                    </Button>
                </div>}
            </div>}

            {view.history.length > 0 && <details className="mt-4 rounded-xl border border-border p-3 text-xs">
                <summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><History className="h-4 w-4 text-primary" />Reviewer history ({view.history.length})</summary>
                <ol className="mt-3 space-y-3 border-l border-border pl-4">
                    {view.history.map(decision => <li key={decision.id} className="relative before:absolute before:-left-[19px] before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-primary">
                        <p className="font-medium">{decisionLabels[decision.decisionKind]} · {reasonLabels[decision.reasonCode]}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{displayDate(decision.createdAt)}{decision.createdBy ? ` · Reviewer ${decision.createdBy}` : ''}</p>
                        {decision.note && <p className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{decision.note}</p>}
                    </li>)}
                </ol>
            </details>}
        </>}

        <Dialog open={confirmOpen} onOpenChange={open => { if (!saving) dispatchForm({ type: 'set_confirmation', open }); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirm reviewer decision</DialogTitle>
                    <DialogDescription className="break-words">{confirmationDescription}</DialogDescription>
                </DialogHeader>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    <p className="font-medium">{currentDecisionKind ? decisionLabels[currentDecisionKind] : 'Reviewer decision'}</p>
                    {reasonCode && <p className="mt-1 text-xs text-muted-foreground">{reasonLabels[reasonCode]}</p>}
                </div>
                {saveError && <p role="alert" className="text-sm text-red-500">{saveError}</p>}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => dispatchForm({ type: 'set_confirmation', open: false })} disabled={saving}>Cancel</Button>
                    <Button type="button" onClick={() => void saveDecision()} disabled={!canSubmit}>
                        {saving && <Loader2 className="animate-spin" />}
                        Confirm decision
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </section>;
}
