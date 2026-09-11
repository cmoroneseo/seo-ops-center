'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

import type { SearchDismissalReason, SearchInvestigation, TaskStatus } from '@/lib/types';

export const SEARCH_DISMISSAL_REASON_LABELS: Record<SearchDismissalReason, string> = {
    not_relevant: 'Not relevant to client',
    branded_or_navigational: 'Branded or navigational',
    wrong_or_unsafe_url: 'Wrong or unsafe URL',
    already_addressed: 'Already addressed',
    insufficient_evidence: 'Insufficient evidence',
    no_action_warranted: 'No action warranted',
    duplicate_investigation: 'Duplicate investigation',
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
    todo: 'To do',
    in_progress: 'In progress',
    review: 'In review',
    done: 'Done',
    approved: 'Approved',
    blocked: 'Blocked',
};

interface DismissInvestigationDialogProps {
    isOpen: boolean;
    busy: boolean;
    onCancel: () => void;
    onConfirm: (reason: SearchDismissalReason, note?: string) => void;
}

export function DismissInvestigationDialog({
    isOpen,
    busy,
    onCancel,
    onConfirm,
}: DismissInvestigationDialogProps) {
    const headingId = useId();
    const reasonId = useId();
    const noteId = useId();
    const reasonRef = useRef<HTMLSelectElement>(null);
    const [reason, setReason] = useState<SearchDismissalReason | ''>('');
    const [note, setNote] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setReason('');
        setNote('');
        requestAnimationFrame(() => reasonRef.current?.focus());
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) onCancel();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [busy, isOpen, onCancel]);

    if (!isOpen) return null;

    return <div
        className="fixed inset-0 z-[140] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        onMouseDown={event => {
            if (event.target === event.currentTarget && !busy) onCancel();
        }}
    >
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl"
        >
            <h3 id={headingId} className="text-lg font-semibold">Dismiss investigation</h3>
            <p className="mt-2 text-sm text-muted-foreground">Record why this evidence does not need action now. It will remain visible and can be restored.</p>
            <div className="mt-5 space-y-4">
                <label htmlFor={reasonId} className="block text-sm font-medium">Reason</label>
                <select
                    ref={reasonRef}
                    id={reasonId}
                    value={reason}
                    onChange={event => setReason(event.target.value as SearchDismissalReason | '')}
                    disabled={busy}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                    <option value="">Select a reason</option>
                    {Object.entries(SEARCH_DISMISSAL_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <label htmlFor={noteId} className="block text-sm font-medium">Optional note</label>
                <textarea
                    id={noteId}
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    maxLength={1000}
                    rows={4}
                    disabled={busy}
                    placeholder="Add evidence or context for the decision."
                    className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
                <p className="text-right text-xs text-muted-foreground">{note.length}/1000</p>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
                <button
                    type="button"
                    disabled={!reason || busy}
                    onClick={() => {
                        if (reason) onConfirm(reason, note.trim() || undefined);
                    }}
                    className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >Confirm dismissal</button>
            </div>
            {busy && <p role="status" className="mt-3 text-sm text-muted-foreground">Saving investigation decision…</p>}
        </div>
    </div>;
}

interface SearchInvestigationActionsProps {
    decision?: SearchInvestigation;
    busy: boolean;
    disabled?: boolean;
    error?: string;
    onCreateTask: () => void;
    onDismiss: (reason: SearchDismissalReason, note?: string) => void;
    onRestore: () => void;
}

export function SearchInvestigationActions({
    decision,
    busy,
    disabled = false,
    error,
    onCreateTask,
    onDismiss,
    onRestore,
}: SearchInvestigationActionsProps) {
    const [dismissOpen, setDismissOpen] = useState(false);
    const unavailable = busy || disabled;

    return <div className="space-y-3">
        {decision?.status === 'dismissed' ? <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">Dismissed</span>
                <span className="text-sm">{decision.dismissalReason ? SEARCH_DISMISSAL_REASON_LABELS[decision.dismissalReason] : 'Reason unavailable'}</span>
            </div>
            {decision.dismissalNote && <p className="text-sm text-muted-foreground">{decision.dismissalNote}</p>}
            <button type="button" onClick={onRestore} disabled={unavailable} className="text-sm text-primary underline disabled:opacity-50">Restore</button>
        </div> : decision?.status === 'task_created' ? <div className="space-y-1">
            <span className="inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Task created</span>
            {decision.linkedTask
                ? <p className="text-sm"><span className="font-medium">{decision.linkedTask.title}</span> · {TASK_STATUS_LABELS[decision.linkedTask.status]}</p>
                : <p className="text-sm text-muted-foreground">The linked task is recorded.</p>}
        </div> : <div className="flex flex-wrap gap-4">
            <button type="button" onClick={onCreateTask} disabled={unavailable} className="text-sm text-primary underline disabled:opacity-50">Create task</button>
            <button type="button" onClick={() => setDismissOpen(true)} disabled={unavailable} className="text-sm text-primary underline disabled:opacity-50">Dismiss</button>
        </div>}
        {busy && <p role="status" className="text-sm text-muted-foreground">Saving investigation decision…</p>}
        {disabled && !busy && <p className="text-xs text-muted-foreground">Decision actions are unavailable until saved workflow data can be loaded.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DismissInvestigationDialog
            isOpen={dismissOpen}
            busy={busy}
            onCancel={() => setDismissOpen(false)}
            onConfirm={(reason, note) => {
                onDismiss(reason, note);
                setDismissOpen(false);
            }}
        />
    </div>;
}
