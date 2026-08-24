'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, X } from 'lucide-react';
import type { Task } from '@/lib/types';
import {
    completionReconciliation,
    formatCompletionDuration,
} from '@/lib/tasks/task-completion';

interface TaskCompletionDrawerProps {
    task: Task;
    trackedHours: number;
    hasOpenAttempt: boolean;
    isLoadingTime?: boolean;
    isSubmitting?: boolean;
    error?: string | null;
    onClose: () => void;
    onComplete: (additionalMinutes: number) => void;
    onStopAndReview?: () => void;
}

function scheduledRange(task: Task): string {
    if (!task.startDate || !task.scheduledMinutes) return 'Not scheduled';
    const start = new Date(task.startDate);
    if (Number.isNaN(start.getTime())) return 'Not scheduled';
    const end = new Date(start.getTime() + task.scheduledMinutes * 60_000);
    const clock = (value: Date) => value.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
    return `${clock(start)} – ${clock(end)}`;
}

export function TaskCompletionDrawer({
    task,
    trackedHours,
    hasOpenAttempt,
    isLoadingTime = false,
    isSubmitting = false,
    error,
    onClose,
    onComplete,
    onStopAndReview,
}: TaskCompletionDrawerProps) {
    const reconciliation = useMemo(() => completionReconciliation({
        scheduledMinutes: task.scheduledMinutes,
        trackedHours,
        hasOpenAttempt,
    }), [hasOpenAttempt, task.scheduledMinutes, trackedHours]);
    const [adjusting, setAdjusting] = useState(false);
    const [additionalMinutes, setAdditionalMinutes] = useState(
        reconciliation.recommendedAdditionalMinutes,
    );

    useEffect(() => {
        setAdjusting(false);
        setAdditionalMinutes(reconciliation.recommendedAdditionalMinutes);
    }, [reconciliation.recommendedAdditionalMinutes, task.id]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSubmitting) onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isSubmitting, onClose]);

    const hours = Math.floor(additionalMinutes / 60);
    const minutes = additionalMinutes % 60;
    const trackedMinutes = reconciliation.trackedMinutes;
    const primaryLabel = reconciliation.mode === 'stop_timer'
        ? 'Stop timer & review'
        : additionalMinutes > 0
            ? `Complete + log ${formatCompletionDuration(additionalMinutes)}`
            : trackedMinutes > 0
                ? `Complete with ${formatCompletionDuration(trackedMinutes)} tracked`
                : 'Complete task';

    const updateDuration = (nextHours: number, nextMinutes: number) => {
        setAdditionalMinutes(Math.min(1440, Math.max(0,
            Math.max(0, nextHours) * 60 + Math.min(59, Math.max(0, nextMinutes)),
        )));
    };

    return (
        <div
            className="absolute inset-0 z-[80] flex items-end bg-black/35"
            onMouseDown={event => {
                if (event.target === event.currentTarget && !isSubmitting) onClose();
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="task-completion-title"
                className="w-full rounded-t-2xl border border-b-0 border-border bg-card shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            >
                <div className="flex justify-center pt-3" aria-hidden="true">
                    <div className="h-1 w-10 rounded-full bg-border" />
                </div>

                <div className="space-y-4 px-5 pb-5 pt-3">
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <h3 id="task-completion-title" className="text-base font-semibold">
                                Finish this task
                            </h3>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                Confirm the time before completing.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            aria-label="Cancel task completion"
                            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch rounded-xl border border-border bg-background/30">
                        <div className="min-w-0 px-3 py-2.5">
                            <div className="text-[11px] text-muted-foreground">Scheduled</div>
                            <div className="mt-0.5 truncate text-xs font-medium">
                                {scheduledRange(task)}
                            </div>
                            <div className="mt-0.5 text-xs font-semibold">
                                {formatCompletionDuration(reconciliation.scheduledMinutes)}
                            </div>
                        </div>
                        <div className="flex items-center">
                            <span className="rounded-full border border-border bg-card px-1.5 py-1 text-[9px] uppercase text-muted-foreground">
                                vs
                            </span>
                        </div>
                        <div className="min-w-0 px-3 py-2.5 text-right">
                            <div className="text-[11px] text-muted-foreground">Tracked</div>
                            <div className="mt-0.5 text-sm font-semibold">
                                {isLoadingTime ? 'Checking…' : formatCompletionDuration(trackedMinutes)}
                            </div>
                        </div>
                    </div>

                    {reconciliation.mode !== 'stop_timer' && (
                        <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                            <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="font-medium">
                                {reconciliation.mode === 'log_scheduled'
                                    ? 'Use scheduled time'
                                    : reconciliation.mode === 'tracked'
                                        ? 'Use tracked time'
                                        : 'Complete without time'}
                            </span>
                            <span className="ml-auto text-[10px] text-muted-foreground">
                                Recommended
                            </span>
                        </div>
                    )}

                    {adjusting && reconciliation.mode !== 'stop_timer' && (
                        <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <div className="mb-2 text-xs font-medium">
                                {trackedMinutes > 0 ? 'Additional time to log' : 'Time to log'}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    Hours
                                    <input
                                        type="number"
                                        min="0"
                                        max="24"
                                        value={hours}
                                        onChange={event => updateDuration(Number(event.target.value), minutes)}
                                        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50"
                                    />
                                </label>
                                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    Minutes
                                    <input
                                        type="number"
                                        min="0"
                                        max="59"
                                        value={minutes}
                                        onChange={event => updateDuration(hours, Number(event.target.value))}
                                        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50"
                                    />
                                </label>
                            </div>
                        </div>
                    )}

                    {error && (
                        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {error}
                        </p>
                    )}

                    <button
                        type="button"
                        autoFocus
                        disabled={isSubmitting || isLoadingTime}
                        onClick={() => {
                            if (reconciliation.mode === 'stop_timer') onStopAndReview?.();
                            else onComplete(additionalMinutes);
                        }}
                        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isLoadingTime ? 'Checking time…' : isSubmitting ? 'Completing…' : primaryLabel}
                    </button>

                    {reconciliation.mode !== 'stop_timer' && (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                disabled={isSubmitting || isLoadingTime}
                                onClick={() => setAdjusting(value => !value)}
                                className="min-h-11 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                            >
                                {adjusting ? 'Use recommended' : 'Adjust time'}
                            </button>
                            <button
                                type="button"
                                disabled={isSubmitting || isLoadingTime}
                                onClick={() => onComplete(0)}
                                className="min-h-11 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                            >
                                Complete without time
                            </button>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
