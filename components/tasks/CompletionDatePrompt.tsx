'use client';

import { useEffect, useId, useState } from 'react';
import { localTimeZone } from '@/lib/timer/manual-segment';
import {
    completionCalendarDay,
    resolveCompletionInstant,
    shiftCalendarDay,
    type CompletionChoice,
} from '@/lib/tasks/completion-date';
import { cn } from '@/lib/utils';

/**
 * Compact "when was this finished?" prompt.
 * Today confirms immediately. Yesterday and a date wait for Confirm.
 * In select mode the parent submits the choice with its own button.
 */
export function CompletionDatePrompt({
    now,
    timeZone,
    pending = false,
    variant = 'commit',
    choice,
    onChoice,
    onConfirm,
    onCancel,
    className,
}: {
    now?: Date;
    timeZone?: string;
    pending?: boolean;
    variant?: 'commit' | 'select';
    choice?: CompletionChoice;
    onChoice?: (choice: CompletionChoice) => void;
    onConfirm?: (completedAt: string) => void;
    onCancel?: () => void;
    className?: string;
}) {
    const titleId = useId();
    const [openedAt] = useState(() => new Date());
    const [zone] = useState(() => timeZone ?? localTimeZone());
    const clock = now ?? openedAt;
    const activeZone = timeZone ?? zone;
    const today = completionCalendarDay(clock, activeZone) ?? '';
    const [internalChoice, setInternalChoice] = useState<CompletionChoice>({ kind: 'today' });
    const [error, setError] = useState<string | null>(null);
    const selected = choice ?? internalChoice;

    useEffect(() => {
        if (variant !== 'commit' || !onCancel) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || pending) return;
            event.preventDefault();
            event.stopPropagation();
            onCancel();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel, pending, variant]);

    const select = (next: CompletionChoice) => {
        setInternalChoice(next);
        onChoice?.(next);
        setError(null);
    };

    const confirm = (next: CompletionChoice) => {
        const resolved = resolveCompletionInstant({ choice: next, now: clock, timeZone: activeZone });
        if (!resolved.ok) {
            setError(resolved.error);
            return;
        }
        setError(null);
        onConfirm?.(resolved.completedAt);
    };

    const dateValue = selected.kind === 'day'
        ? selected.day
        : selected.kind === 'yesterday'
            ? (shiftCalendarDay(today, -1) ?? '')
            : '';

    return (
        <div
            role="dialog"
            aria-labelledby={titleId}
            data-completion-date-prompt
            data-completion-selected={selected.kind}
            className={cn(
                'rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-lg',
                className,
            )}
        >
            <p id={titleId} className="text-xs font-medium">When was this finished?</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    data-completion-choice="today"
                    disabled={pending}
                    className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50',
                        selected.kind === 'today' || variant === 'commit'
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'border border-border bg-transparent hover:bg-muted',
                    )}
                    onClick={() => {
                        if (variant === 'select') select({ kind: 'today' });
                        else confirm({ kind: 'today' });
                    }}
                >
                    Today
                </button>
                <button
                    type="button"
                    data-completion-choice="yesterday"
                    disabled={pending}
                    aria-pressed={selected.kind === 'yesterday'}
                    className={cn(
                        'rounded-md border px-2.5 py-1 text-xs disabled:opacity-50',
                        selected.kind === 'yesterday'
                            ? 'border-primary bg-primary/15 font-medium'
                            : 'border-border hover:bg-muted',
                    )}
                    onClick={() => select({ kind: 'yesterday' })}
                >
                    Yesterday
                </button>
                <input
                    type="date"
                    data-completion-date
                    max={today || undefined}
                    value={dateValue}
                    disabled={pending}
                    aria-label="Finished on"
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                    onChange={event => {
                        const day = event.target.value;
                        select(day ? { kind: 'day', day } : { kind: 'today' });
                    }}
                />
                {variant === 'commit' && (
                    <>
                        <button
                            type="button"
                            data-completion-confirm
                            disabled={pending}
                            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                            onClick={() => confirm(selected)}
                        >
                            Confirm
                        </button>
                        <button
                            type="button"
                            data-completion-cancel
                            disabled={pending}
                            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                            onClick={onCancel}
                        >
                            Cancel
                        </button>
                    </>
                )}
            </div>
            {error && <p role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>}
        </div>
    );
}
