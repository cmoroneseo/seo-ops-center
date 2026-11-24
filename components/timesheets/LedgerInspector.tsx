'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { X, CheckCircle2, AlertTriangle, ExternalLink, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatHourAmount } from '@/lib/hour-format';
import { formatDayHeading, formatDuration, formatSourceLabel } from '@/lib/timesheets/format';
import type { LedgerLog, LedgerClientGroup, LedgerTaskRow } from '@/lib/timesheets/ledger';
import { midnightSplitLabel } from '@/lib/timer/attempt-state';

interface LedgerInspectorProps {
    group: LedgerClientGroup;
    row: LedgerTaskRow;
    /** Every entry in the week; the inspector filters to this row's ids. */
    entries: LedgerLog[];
    onClose: () => void;
    onAddTime: () => void;
    onMap?: (timeLogId: string) => void;
    onPausedTrimSaved?: () => void;
}

function PausedTimeEdit({ entry, onSaved }: { entry: LedgerLog; onSaved: () => void }) {
    const [open, setOpen] = useState(false);
    const [hours, setHours] = useState('');
    const [description, setDescription] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const correctedHours = Number(hours);
        if (!Number.isFinite(correctedHours) || correctedHours <= 0) {
            setError('Hours must be greater than 0.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const response = await fetch(`/api/timesheets/ledger/${encodeURIComponent(entry.id)}/trim`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hours: correctedHours, description }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Unable to save time.');
            setOpen(false);
            onSaved();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save time.');
        } finally {
            setSaving(false);
        }
    }

    const inputClass = 'mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground';
    const actionClass = 'rounded text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
    if (!open) {
        return (
            <button type="button" className={cn('mt-3', actionClass)} onClick={() => {
                const seconds = entry.pausedRunningSeconds ?? entry.elapsedSeconds;
                setHours(String(seconds === undefined ? entry.hours : Math.floor(seconds / 3600 * 1e9) / 1e9));
                setDescription(entry.description);
                setError('');
                setOpen(true);
            }}>
                Edit time
            </button>
        );
    }

    return (
        <form className="mt-3 space-y-2 border-t border-border pt-3" onSubmit={save} noValidate>
            <label className="block text-sm font-medium">
                Hours
                <input type="number" inputMode="decimal" step="any" value={hours} disabled={saving}
                    onChange={event => setHours(event.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm font-medium">
                Description
                <textarea value={description} disabled={saving} maxLength={2000} rows={3}
                    onChange={event => setDescription(event.target.value)} className={inputClass} />
            </label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-4">
                <button type="submit" disabled={saving} className={actionClass}>{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" disabled={saving} onClick={() => setOpen(false)} className="text-sm text-muted-foreground">Cancel</button>
            </div>
        </form>
    );
}

export function LedgerInspector({
    group,
    row,
    entries,
    onClose,
    onAddTime,
    onMap,
    onPausedTrimSaved,
}: LedgerInspectorProps) {
    const headingRef = useRef<HTMLHeadingElement>(null);

    // Selecting a row moves focus into the panel so the grid stays keyboard
    // navigable; Escape returns control to the grid.
    useEffect(() => {
        headingRef.current?.focus();
    }, [row.key]);

    const rowEntries = entries
        .filter(entry => row.entryIds.includes(entry.id))
        .sort((left, right) => left.date.localeCompare(right.date));

    const budgetLabel = group.paused
        ? 'Not budget time until stop'
        : group.isInternal
        ? 'Internal'
        : rowEntries.every(entry => entry.countsTowardBudget)
            ? 'SEO budget'
            : rowEntries.some(entry => entry.countsTowardBudget)
                ? 'Mixed budget'
                : 'Non-budget';

    return (
        <aside
            aria-label={`Entries for ${row.taskTitle}`}
            onKeyDown={event => {
                if (event.key === 'Escape') onClose();
            }}
            className="flex h-full w-full flex-col rounded-xl border border-border bg-card"
        >
            <header className="flex items-start justify-between gap-3 border-b border-border p-5">
                <div className="min-w-0">
                    <h2
                        ref={headingRef}
                        tabIndex={-1}
                        className="text-lg font-semibold leading-snug text-foreground outline-none"
                    >
                        {row.taskTitle}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {group.clientName}
                        <span aria-hidden className="mx-2">•</span>
                        {budgetLabel}
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                        Total this week: {formatDuration(row.totalMinutes, { zero: '0m' })}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close entry details"
                    className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    <X className="h-5 w-5" aria-hidden />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
                <h3 className="text-sm font-medium text-foreground">
                    Time entries ({rowEntries.length})
                </h3>

                <ul className="mt-3 space-y-3">
                    {rowEntries.map(entry => {
                        const heading = formatDayHeading(entry.date);
                        const needsReview = entry.importStatus === 'needs_context';
                        const cappedBotTimer = entry.status === 'needs_review';
                        const pausedBotTimer = entry.status === 'paused';
                        const splitNote = midnightSplitLabel(entry, entries);
                        return (
                            <li
                                key={entry.id}
                                className="rounded-lg border border-border bg-background p-4"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                                        <span
                                            aria-hidden
                                            className={cn(
                                                'h-1.5 w-1.5 rounded-full',
                                                entry.source === 'basecamp' ? 'bg-sky-400' : 'bg-primary',
                                            )}
                                        />
                                        {heading.weekday}, {heading.date}
                                    </span>
                                    <span className="text-sm font-medium tabular-nums text-foreground">
                                        {formatDuration(Math.round(entry.hours * 60), { zero: '0m' })}
                                    </span>
                                </div>

                                {splitNote && (
                                    <p data-split-note className="mt-2 text-sm text-foreground">
                                        {splitNote}
                                    </p>
                                )}

                                <div className="mt-1 flex items-center justify-between gap-3">
                                    <p className={cn(
                                        'min-w-0 text-sm text-muted-foreground',
                                        pausedBotTimer && 'whitespace-pre-line',
                                    )}>
                                        {entry.description || 'No description'}
                                    </p>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {formatSourceLabel([entry.source])}
                                    </span>
                                </div>

                                {cappedBotTimer && (
                                    <p className="mt-2 flex items-start gap-2 text-sm text-amber-500">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                                        <span>
                                            Stopped at the timer cap.
                                            {entry.clientName ? ` ${entry.clientName}.` : ''}
                                            {' '}Review it in the client activity feed before it counts.
                                        </span>
                                    </p>
                                )}

                                {pausedBotTimer && (
                                    <p className="mt-2 text-sm text-foreground">
                                        Paused. The time so far stays on this entry. Nothing was sent to Basecamp.
                                    </p>
                                )}

                                {entry.trimmedFromSeconds !== undefined && (
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        Trimmed from {formatHourAmount(entry.trimmedFromSeconds / 3600)} h
                                    </p>
                                )}

                                <div className="mt-3 flex items-center justify-between gap-3">
                                    {pausedBotTimer ? (
                                        <span className="text-sm font-medium text-foreground">Paused</span>
                                    ) : cappedBotTimer ? (
                                        <span className="flex items-center gap-2 text-sm text-amber-500">
                                            <AlertTriangle className="h-4 w-4" aria-hidden />
                                            Needs review
                                        </span>
                                    ) : needsReview ? (
                                        <span className="flex items-center gap-2 text-sm text-amber-500">
                                            <AlertTriangle className="h-4 w-4" aria-hidden />
                                            Needs mapping
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                                            {entry.taskId ? 'Mapped to task' : 'Mapped to client'}
                                        </span>
                                    )}

                                    {needsReview && onMap && (
                                        <button
                                            type="button"
                                            onClick={() => onMap(entry.id)}
                                            className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                        >
                                            Map entry
                                        </button>
                                    )}
                                </div>
                                {pausedBotTimer && entry.isBotTimer && onPausedTrimSaved && (
                                    <PausedTimeEdit entry={entry} onSaved={onPausedTrimSaved} />
                                )}
                            </li>
                        );
                    })}
                </ul>

                <button
                    type="button"
                    onClick={onAddTime}
                    className="mt-4 flex items-center gap-2 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    <Plus className="h-4 w-4" aria-hidden />
                    Add time to this task
                </button>

                {row.sources.length > 0 && (
                    <section className="mt-6">
                        <h3 className="text-sm font-medium text-foreground">Row details</h3>
                        <dl className="mt-3 rounded-lg border border-border bg-background p-4 text-sm">
                            <div className="flex items-center justify-between py-1">
                                <dt className="text-muted-foreground">Source of truth</dt>
                                <dd className="text-foreground">{formatSourceLabel(row.sources)}</dd>
                            </div>
                            <div className="flex items-center justify-between py-1">
                                <dt className="text-muted-foreground">Entries</dt>
                                <dd className="text-foreground">{row.entryIds.length}</dd>
                            </div>
                        </dl>
                    </section>
                )}
            </div>

            {row.taskId && (
                <footer className="border-t border-border p-5">
                    <Link
                        href={`/tasks?task=${encodeURIComponent(row.taskId)}`}
                        className="flex items-center justify-center gap-2 rounded-lg border border-primary px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        Open task
                        <ExternalLink className="h-4 w-4" aria-hidden />
                    </Link>
                </footer>
            )}
        </aside>
    );
}
