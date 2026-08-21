'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { X, Clock, CheckCircle2, StickyNote, ChevronDown, ChevronUp, Pencil, Check } from 'lucide-react';
import { useTimer } from '@/components/providers/timer-provider';
import { getClientTimesheetSyncEnabled } from '@/lib/supabase/time-logs';
import { SessionNote } from '@/lib/types';
import { cn } from '@/lib/utils';

function renderNoteText(text: string) {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (match) {
            return (
                <a key={i} href={match[2]} className="text-primary underline underline-offset-2 hover:opacity-80">
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

interface StopConfirmSheetProps {
    attemptId: string;
    onClose: () => void;
}

export function StopConfirmSheet({ attemptId, onClose }: StopConfirmSheetProps) {
    const { finalize, discard, editNote, getAttemptById, getElapsedSeconds } = useTimer();
    const timer = getAttemptById(attemptId);
    const [description, setDescription] = useState('');
    const [billable, setBillable] = useState(true);
    const [showNotes, setShowNotes] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [bcAvailable, setBcAvailable] = useState(false);
    const [sendToBasecamp, setSendToBasecamp] = useState(true);
    const [isCheckingBasecamp, setIsCheckingBasecamp] = useState(false);
    const timerId = timer?.id;
    const timerBillable = timer?.billable;
    const timerNoteCount = timer?.sessionNotes.length ?? 0;

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

    useEffect(() => {
        if (timerBillable === undefined) return;
        setBillable(timerBillable);
        setShowNotes(timerNoteCount > 0);
    }, [timerBillable, timerId, timerNoteCount]);

    const handleStop = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!timer || !description.trim() || isCheckingBasecamp) return;
        setIsSubmitting(true);
        await finalize(timer, {
            description: description.trim(),
            billable,
            syncToBasecamp: bcAvailable && sendToBasecamp,
        });
        setShowSuccess(true);
        setTimeout(() => {
            setShowSuccess(false);
            onClose();
        }, 1200);
        setIsSubmitting(false);
    };

    const handleDiscard = async () => {
        if (!timer) return;
        await discard(timer);
        onClose();
    };

    if (!timer) return null;
    const trackedSeconds = getElapsedSeconds(timer);

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
                        {bcAvailable && sendToBasecamp && (
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
                            <p className="mt-0.5 text-[11px] text-muted-foreground">Derived from recorded timer segments.</p>
                        </div>

                        {/* Billable toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                            <div
                                className={cn(
                                    'relative w-9 h-5 rounded-full transition-colors duration-200',
                                    billable ? 'bg-primary' : 'bg-muted-foreground/30'
                                )}
                                onClick={() => setBillable(b => !b)}
                            >
                                <span className={cn(
                                    'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                                    billable ? 'translate-x-4' : 'translate-x-0'
                                )} />
                            </div>
                            <span className="text-muted-foreground">Billable</span>
                        </label>

                        {/* Send to Basecamp toggle — only when this client syncs its timesheet */}
                        {bcAvailable && (
                            <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                                <div
                                    className={cn(
                                        'relative w-9 h-5 rounded-full transition-colors duration-200',
                                        sendToBasecamp ? 'bg-primary' : 'bg-muted-foreground/30'
                                    )}
                                    onClick={() => setSendToBasecamp(b => !b)}
                                >
                                    <span className={cn(
                                        'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                                        sendToBasecamp ? 'translate-x-4' : 'translate-x-0'
                                    )} />
                                </div>
                                <span className="text-muted-foreground">
                                    Send to Basecamp
                                    <span className="text-xs text-muted-foreground/60 ml-1.5">adds to the client's project timesheet</span>
                                </span>
                            </label>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3 pt-1 pb-2">
                            <button
                                type="button"
                                onClick={handleDiscard}
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
                                ) : 'Log Time'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
