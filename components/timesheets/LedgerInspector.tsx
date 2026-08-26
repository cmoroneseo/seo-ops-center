'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { X, CheckCircle2, AlertTriangle, ExternalLink, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDayHeading, formatDuration, formatSourceLabel } from '@/lib/timesheets/format';
import type { LedgerLog, LedgerClientGroup, LedgerTaskRow } from '@/lib/timesheets/ledger';

interface LedgerInspectorProps {
    group: LedgerClientGroup;
    row: LedgerTaskRow;
    /** Every entry in the week; the inspector filters to this row's ids. */
    entries: LedgerLog[];
    onClose: () => void;
    onAddTime: () => void;
    onMap?: (timeLogId: string) => void;
}

/**
 * Progressive disclosure for one grid row: the individual entries behind the
 * cell, where each came from, and whether it is fully mapped.
 *
 * Editing stays on the existing hardened time-log routes — this panel opens
 * them, it does not reimplement them.
 */
export function LedgerInspector({
    group,
    row,
    entries,
    onClose,
    onAddTime,
    onMap,
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

    const budgetLabel = group.isInternal
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

                                <div className="mt-1 flex items-center justify-between gap-3">
                                    <p className="min-w-0 text-sm text-muted-foreground">
                                        {entry.description || 'No description'}
                                    </p>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {formatSourceLabel([entry.source])}
                                    </span>
                                </div>

                                <div className="mt-3 flex items-center justify-between gap-3">
                                    {needsReview ? (
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
                        href={`/tasks?taskId=${row.taskId}`}
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
