'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { X, Clock, CheckCircle2, StickyNote, ChevronDown, ChevronUp, Pencil, Check } from 'lucide-react';
import { useTimer } from '@/components/providers/timer-provider';
import {
    basecampSyncEligibility,
    stopReviewDefaults,
    stopReviewSummary,
    stopSubmitFailure,
    stopSubmitOutcome,
    type BasecampSyncEligibility,
    type StopSubmitOutcome,
} from '@/lib/timer-ui';
import { getClientTimesheetSyncEnabled } from '@/lib/supabase/time-logs';
import { SessionNote } from '@/lib/types';
import { cn } from '@/lib/utils';
import { isExternalHref, safeHref } from '@/lib/links/safe-href';

function renderNoteText(text: string) {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (match) {
            // Never trust the captured URL. A note reading
            // `[click](javascript:alert(document.cookie))` used to render as a
            // working script link; a rejected URL now degrades to plain label
            // text so what the person typed is still readable.
            const href = safeHref(match[2]);
            if (!href) return <span key={i}>{match[1]}</span>;
            const external = isExternalHref(href);
            return (
                <a
                    key={i}
                    href={href}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                    className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                    {match[1]}
                </a>
            );
        }
        return <span key={i}>{part}</span>;
    });
}

function EditableNoteRow({ note, onEdit }: { note: SessionNote; onEdit: (text: string) => void }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(note.text);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { if (editing) { ref.current?.focus(); const l = draft.length; ref.current?.setSelectionRange(l, l); } }, [draft.length, editing]);

    const confirm = () => { const t = draft.trim(); if (t && t !== note.text) onEdit(t); else setDraft(note.text); setEditing(false); };
    const cancel = () => { setDraft(note.text); setEditing(false); };
    const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirm(); } if (e.key === 'Escape') cancel(); };

    return (
        <div className="group flex items-start gap-2 pt-1.5">
            <div className="flex-1 min-w-0">
                {editing ? (
                    <textarea ref={ref} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={handleKey} onBlur={confirm} rows={2}
                        className="w-full bg-background border border-primary/50 rounded-lg px-2 py-1 text-xs outline-none resize-none focus:ring-1 focus:ring-primary/30 leading-relaxed" />
                ) : (
                    <p className="text-xs text-foreground/80 leading-relaxed cursor-text" onDoubleClick={() => setEditing(true)}>
                        {renderNoteText(note.text)}
                    </p>
                )}
                <span className="text-[10px] text-muted-foreground">{new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <button onClick={() => setEditing(e => !e)} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground mt-0.5">
                {editing ? <Check className="h-3 w-3 text-green-500" /> : <Pencil className="h-3 w-3" />}
            </button>
        </div>
    );
}

function secondsToHours(s: number) {
    return Math.round((s / 3600) * 100) / 100;
}

function formatHHMM(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function ReviewToggle({
    checked,
    disabled = false,
    label,
    hint,
    onChange,
}: {
    checked: boolean;
    disabled?: boolean;
    label: string;
    hint?: string;
    onChange: (next: boolean) => void;
}) {
    return (
        <label className={cn('flex items-start gap-2 select-none text-sm', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
            <input
                type="checkbox"
                role="switch"
                checked={checked}
                disabled={disabled}
                onChange={event => onChange(event.target.checked)}
                className="sr-only peer"
            />
            <span
                aria-hidden="true"
                className={cn(
                    'relative mt-0.5 w-9 h-5 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50',
                    checked ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
            >
                <span className={cn(
                    'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                    checked ? 'translate-x-4' : 'translate-x-0',
                )} />
            </span>
            <span className="text-muted-foreground">
                {label}
                {hint && <span className="block text-xs text-muted-foreground/60">{hint}</span>}
            </span>
        </label>
    );
}

interface StopConfirmSheetProps {
    attemptId: string;
    onClose: () => void;
    /** Completion initiated from a Done transition keeps that intent selected. */
    defaultMarkTaskComplete?: boolean;
}

export function StopConfirmSheet({
    attemptId,
    onClose,
    defaultMarkTaskComplete = false,
}: StopConfirmSheetProps) {
    const { finalize, discard, editNote, getAttemptById } = useTimer();
    const timer = getAttemptById(attemptId);
    const [description, setDescription] = useState('');
    const [billable, setBillable] = useState(true);
    const [countsTowardBudget, setCountsTowardBudget] = useState(false);
    const [markTaskComplete, setMarkTaskComplete] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [bcAvailable, setBcAvailable] = useState(false);
    const [sendToBasecamp, setSendToBasecamp] = useState(true);
    const [isCheckingBasecamp, setIsCheckingBasecamp] = useState(false);
    const [outcome, setOutcome] = useState<StopSubmitOutcome | null>(null);
    const timerId = timer?.id;
    const timerNoteCount = timer?.sessionNotes.length ?? 0;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const review = timer ? stopReviewSummary(timer, timeZone) : null;
    const trackedSeconds = review?.totalActiveSeconds ?? 0;
    const canMarkTaskComplete = Boolean(timer?.taskId);
    const isClientWork = Boolean(timer?.clientId);
    const basecamp: BasecampSyncEligibility = timer
        ? basecampSyncEligibility(timer, bcAvailable)
        : { eligible: false };
    const willSyncToBasecamp = basecamp.eligible && sendToBasecamp;

    // Only offer "Send to Basecamp" when this client has timesheet sync enabled
    useEffect(() => {
        let active = true;
        if (!timer?.clientId) {
            setBcAvailable(false);
            setIsCheckingBasecamp(false);
            return;
        }
        setIsCheckingBasecamp(true);
        getClientTimesheetSyncEnabled(timer.clientId).then(enabled => {
            if (!active) return;
            setBcAvailable(enabled);
            setIsCheckingBasecamp(false);
        });
        return () => { active = false; };
    }, [timer?.clientId]);

    // Review defaults come from the canonical attempt, not from prior sheet state.
    useEffect(() => {
        const reviewed = timerId ? getAttemptById(timerId) : null;
        if (!reviewed) return;
        const defaults = stopReviewDefaults(reviewed);
        setBillable(defaults.billable);
        setCountsTowardBudget(defaults.countsTowardBudget);
        setMarkTaskComplete(defaultMarkTaskComplete || defaults.markTaskComplete);
        setShowNotes(timerNoteCount > 0);
        // Defaults are seeded once per reviewed attempt.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultMarkTaskComplete, timerId]);

    const handleStop = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!timer || !description.trim() || isCheckingBasecamp || isSubmitting) return;
        setIsSubmitting(true);
        setOutcome(null);
        let result: StopSubmitOutcome;
        try {
            result = stopSubmitOutcome(await finalize(timer, {
                description: description.trim(),
                billable,
                countsTowardBudget,
                markTaskComplete,
                syncToBasecamp: willSyncToBasecamp,
            }));
        } catch (error) {
            // The attempt stays in review on the server, so submission can retry.
            setOutcome(stopSubmitFailure(error));
            setIsSubmitting(false);
            return;
        }
        setIsSubmitting(false);
        if (result.status === 'warned') {
            // The attempt has left canonical state, so this terminal panel must
            // not depend on it still being resolvable.
            setOutcome(result);
            return;
        }
        setShowSuccess(true);
        setTimeout(() => {
            setShowSuccess(false);
            onClose();
        }, 1200);
    };

    const handleDiscard = async () => {
        if (!timer || isSubmitting) return;
        const confirmed = window.confirm(
            `Discard ${formatHHMM(trackedSeconds)} of tracked work? This cannot be undone and nothing is sent to Basecamp.`,
        );
        if (!confirmed) return;
        await discard(timer);
        onClose();
    };

    if (outcome?.status === 'warned') {
        return (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
                <div
                    className="w-full max-w-lg bg-card border border-border border-b-0 rounded-t-2xl shadow-2xl px-5 py-6 space-y-3"
                    onClick={event => event.stopPropagation()}
                    role="alertdialog"
                    aria-label="Time entry saved with a warning"
                >
                    <p className="font-semibold text-sm">Time entry saved</p>
                    <p className="text-sm text-muted-foreground">{outcome.message}</p>
                    <button
                        type="button"
                        autoFocus
                        onClick={onClose}
                        className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        );
    }

    if (!timer || !review) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-lg mb-0 bg-card border border-border border-b-0 rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Handle bar */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full bg-border" />
                </div>

                <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-sm">Log Time</span>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            {formatHHMM(trackedSeconds)}
                        </span>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {showSuccess ? (
                    <div className="px-5 py-10 flex flex-col items-center gap-3 animate-in fade-in">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                            <CheckCircle2 className="h-6 w-6" />
                        </div>
                        <p className="font-semibold">Time logged!</p>
                        <p className="text-sm text-muted-foreground">{formatHHMM(trackedSeconds)} for {timer.clientName}</p>
                        {willSyncToBasecamp && (
                            <p className="text-xs text-muted-foreground/70">Sending to Basecamp timesheet…</p>
                        )}
                    </div>
                ) : (
                    <form onSubmit={handleStop} className="px-5 py-4 space-y-4">
                        {/* Client / task context */}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="bg-primary/10 text-primary font-medium px-2 py-0.5 rounded-full text-xs">
                                {timer.clientName || 'Unassigned'}
                            </span>
                            {timer.taskTitle && (
                                <span className="text-xs truncate max-w-[200px]">{timer.taskTitle}</span>
                            )}
                        </div>

                        {/* Session notes (read-only context) */}
                        {timer.sessionNotes.length > 0 && (
                            <div className="rounded-xl border border-border/60 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setShowNotes(p => !p)}
                                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                >
                                    <span className="flex items-center gap-1.5">
                                        <StickyNote className="h-3 w-3" />
                                        Session Notes ({timer.sessionNotes.length})
                                    </span>
                                    {showNotes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </button>
                                {showNotes && (
                                    <div className="px-3 pb-2 space-y-1.5 max-h-32 overflow-y-auto border-t border-border/40">
                                        {timer.sessionNotes.map(n => (
                                            <EditableNoteRow
                                                key={n.id}
                                                note={n}
                                                onEdit={text => editNote(timer.id, n.id, text)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Description */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">What did you work on? *</label>
                            <textarea
                                autoFocus
                                required
                                rows={2}
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Brief description of the work..."
                                className="w-full p-2.5 rounded-lg bg-background border border-border text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all resize-none"
                            />
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                            <p className="text-xs font-medium text-muted-foreground">Tracked time</p>
                            <p className="mt-0.5 font-mono text-sm text-foreground">{formatHHMM(trackedSeconds)} ({secondsToHours(trackedSeconds)}h)</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">Active time only — pauses are excluded.</p>
                            {review.dates.length > 0 && (
                                <ul className="mt-2 space-y-0.5 border-t border-border/50 pt-1.5">
                                    {review.dates.map(day => (
                                        <li key={day.localDate} className="flex items-center justify-between text-[11px] text-muted-foreground">
                                            <span>
                                                {day.localDate}
                                                {day.segmentCount > 0 && (
                                                    <span className="ml-1.5 text-muted-foreground/60">
                                                        {day.segmentCount} {day.segmentCount === 1 ? 'session' : 'sessions'}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="font-mono">{secondsToHours(day.activeSeconds)}h</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {review.dates.length > 1 && (
                                <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                                    This work crosses midnight, so one time entry is saved per date.
                                </p>
                            )}
                        </div>

                        <div className="space-y-3">
                            <ReviewToggle
                                checked={billable}
                                label="Billable"
                                onChange={setBillable}
                            />

                            <ReviewToggle
                                checked={countsTowardBudget}
                                disabled={!isClientWork}
                                label="Counts toward SEO hours"
                                hint={isClientWork
                                    ? "Adds this time to the client's monthly SEO-hour usage."
                                    : 'Internal work never consumes a client\u2019s SEO hours.'}
                                onChange={setCountsTowardBudget}
                            />

                            <ReviewToggle
                                checked={willSyncToBasecamp}
                                disabled={!basecamp.eligible || isCheckingBasecamp}
                                label={isCheckingBasecamp ? 'Checking Basecamp\u2026' : 'Send to Basecamp'}
                                hint={basecamp.eligible
                                    ? "Adds this time to the client's project timesheet."
                                    : basecamp.reason}
                                onChange={setSendToBasecamp}
                            />

                            <ReviewToggle
                                checked={markTaskComplete}
                                disabled={!canMarkTaskComplete}
                                label="Mark task complete"
                                hint={canMarkTaskComplete
                                    ? 'Stopping the timer alone leaves the task open.'
                                    : 'This time is not linked to a task.'}
                                onChange={setMarkTaskComplete}
                            />
                        </div>

                        {outcome?.status === 'failed' && (
                            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                {outcome.message}
                            </p>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3 pt-1 pb-2">
                            <button
                                type="button"
                                onClick={handleDiscard}
                                disabled={isSubmitting}
                                className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                            >
                                Discard
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting || isCheckingBasecamp || !description.trim()}
                                className="flex-[2] py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isSubmitting || isCheckingBasecamp ? (
                                    <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : `Confirm ${secondsToHours(trackedSeconds)}h time entry`}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
