'use client';

import { useEffect, useState } from 'react';
import { Clock, ChevronDown, Pause, Play, Plus, Square, StickyNote } from 'lucide-react';
import { useTimer } from '@/components/providers/timer-provider';
import { StopConfirmSheet } from './StopConfirmSheet';
import { QuickStartPopover } from './QuickStartPopover';
import { TimerNotes } from './TimerNotes';
import type { ClientProject, TimerAttempt } from '@/lib/types';
import { formatTimerStartClock, runningSegmentStartedAt, timerTaskLabel } from '@/lib/timer/widget-label';
import { toastClearancePx } from '@/lib/toasts/toast-clearance';
import { cn } from '@/lib/utils';

/** Publishes the gap toasts must leave so they stack above this widget. */
function useToastClearance(node: HTMLElement | null) {
    useEffect(() => {
        if (!node || typeof document === 'undefined') return;
        const apply = () => {
            const clearance = toastClearancePx(window.innerHeight, node.getBoundingClientRect().top);
            document.documentElement.style.setProperty('--toast-clearance', `${clearance}px`);
        };
        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(node);
        window.addEventListener('resize', apply);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', apply);
            document.documentElement.style.removeProperty('--toast-clearance');
        };
    }, [node]);
}

function formatElapsed(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

interface FloatingTimerProps {
    clients: ClientProject[];
}

export function FloatingTimer({ clients }: FloatingTimerProps) {
    const { runningTimer, pausedTimers, getElapsedSeconds, pause, resume, beginStop } = useTimer();
    const [expanded, setExpanded] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [showQuickStart, setShowQuickStart] = useState(false);
    const [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null);
    const [widgetNode, setWidgetNode] = useState<HTMLDivElement | null>(null);
    useToastClearance(widgetNode);
    const primaryTimer = runningTimer ?? pausedTimers[0] ?? null;

    useEffect(() => {
        const handler = () => setShowQuickStart(true);
        window.addEventListener('timer:open-quick-start', handler);
        return () => window.removeEventListener('timer:open-quick-start', handler);
    }, []);

    useEffect(() => {
        if (primaryTimer) setExpanded(true);
    }, [primaryTimer]);

    useEffect(() => {
        if (!expanded) return;
        const handleClick = (event: MouseEvent) => {
            if (widgetNode && !widgetNode.contains(event.target as Node)) setExpanded(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [expanded, widgetNode]);

    const [stopError, setStopError] = useState<string | null>(null);

    const openStopReview = async (attempt: TimerAttempt) => {
        try {
            if (!attempt.reviewingAt) await beginStop(attempt);
        } catch (error) {
            // Another tab may have already closed this segment. Surface it
            // instead of leaving a Stop click with no visible effect.
            setStopError(error instanceof Error ? error.message : 'Unable to stop this timer.');
            return;
        }
        setStopError(null);
        setReviewAttemptId(attempt.id);
    };

    if (!primaryTimer) {
        // The sheet must survive here: finalizing the last attempt clears
        // primaryTimer, and its outcome panel still has to report a failed
        // completion or Basecamp push.
        return (
            <div ref={setWidgetNode} className="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-50">
                {reviewAttemptId && <StopConfirmSheet attemptId={reviewAttemptId} onClose={() => setReviewAttemptId(null)} />}
                <div className="relative">
                    <button
                        onClick={() => setShowQuickStart(current => !current)}
                        title="Start Timer  ⌘⇧T"
                        className="group h-14 w-14 flex items-center justify-center rounded-full bg-card border border-border shadow-lg hover:border-[#ec4899]/50 hover:bg-[#ec4899]/10 hover:shadow-[#ec4899]/10 transition-all duration-200"
                    >
                        <Clock className="h-5 w-5 text-muted-foreground group-hover:text-[#ec4899] transition-colors" />
                    </button>
                    {showQuickStart && (
                        <div className="absolute bottom-16 right-0">
                            <QuickStartPopover clients={clients} onClose={() => setShowQuickStart(false)} />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const runningElapsed = runningTimer ? getElapsedSeconds(runningTimer) : null;
    const primaryIsRunning = primaryTimer.id === runningTimer?.id;
    const primaryLabel = timerTaskLabel(primaryTimer);
    const runningStarted = runningTimer
        ? formatTimerStartClock(runningSegmentStartedAt(runningTimer))
        : null;

    if (!expanded) {
        return (
            <div ref={setWidgetNode} className="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-50">
                <button
                    onClick={() => setExpanded(true)}
                    title={runningStarted ? `${primaryLabel}. ${runningStarted}` : primaryLabel}
                    className={cn(
                        'group flex items-center gap-2.5 pl-3 pr-4 h-12 rounded-full shadow-lg border transition-all duration-200 hover:scale-105',
                        primaryIsRunning ? 'bg-card border-[#ec4899]/40 shadow-[#ec4899]/10 hover:border-[#ec4899]/70' : 'bg-card border-amber-500/30 shadow-amber-500/10 hover:border-amber-500/60',
                    )}
                >
                    <span className={cn('h-2 w-2 rounded-full shrink-0', primaryIsRunning ? 'bg-[#ec4899] animate-pulse' : 'bg-amber-500')} />
                    <span data-timer-task className="max-w-[10rem] truncate text-xs font-medium text-foreground">{primaryLabel}</span>
                    <span className={cn('font-mono font-semibold text-sm tabular-nums', primaryIsRunning ? 'text-[#ec4899]' : 'text-amber-400')}>
                        {formatElapsed(runningElapsed ?? getElapsedSeconds(primaryTimer))}
                    </span>
                </button>
            </div>
        );
    }

    return (
        <div ref={setWidgetNode} className="fixed bottom-24 right-4 lg:bottom-6 lg:right-6 z-50 w-72 animate-in slide-in-from-bottom-3 fade-in duration-200">
            <div className={cn('bg-card border rounded-2xl shadow-2xl overflow-hidden', runningTimer ? 'border-[#ec4899]/30 shadow-[#ec4899]/5' : 'border-amber-500/30')}>
                <div className={cn('h-0.5 w-full', runningTimer ? 'bg-gradient-to-r from-[#ec4899]/0 via-[#ec4899] to-[#ec4899]/0 animate-pulse' : 'bg-amber-500/60')} />

                <div className="px-4 pt-4 pb-2 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className={cn('h-2 w-2 rounded-full shrink-0', runningTimer ? 'bg-[#ec4899] animate-pulse' : 'bg-amber-500')} />
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{runningTimer ? 'Tracking' : 'Paused'}</span>
                        </div>
                        <button onClick={() => setExpanded(false)} aria-label="Collapse timer" className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                            <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {runningTimer && (
                        <>
                            <div>
                                <p className="font-semibold text-foreground truncate">{runningTimer.clientName || 'Unassigned'}</p>
                                <p data-timer-task className="text-xs text-muted-foreground truncate mt-0.5">{timerTaskLabel(runningTimer)}</p>
                                {runningStarted && (
                                    <p data-timer-started className="text-xs text-muted-foreground truncate">{runningStarted}</p>
                                )}
                            </div>
                            <div className="text-4xl font-mono font-bold tabular-nums tracking-tight text-[#ec4899]">{formatElapsed(runningElapsed!)}</div>
                            <div className="flex items-center gap-2 pt-1">
                                <button onClick={() => void pause(runningTimer)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-[#ec4899]/15 text-[#ec4899] hover:bg-[#ec4899]/25 transition-all duration-150">
                                    <Pause className="h-4 w-4 fill-current" /> Pause
                                </button>
                                <button onClick={() => void openStopReview(runningTimer)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted text-sm font-medium text-muted-foreground hover:bg-destructive/15 hover:text-red-400 transition-all duration-150">
                                    <Square className="h-4 w-4 fill-current" /> Stop
                                </button>
                            </div>
                            <button onClick={() => setShowNotes(current => !current)} className={cn('w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs transition-colors', showNotes ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted')}>
                                <StickyNote className="h-3 w-3" /> Session Notes
                                {runningTimer.sessionNotes.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold leading-none">{runningTimer.sessionNotes.length}</span>}
                            </button>
                        </>
                    )}

                    {pausedTimers.length > 0 && (
                        <div className={cn('space-y-2', runningTimer && 'border-t border-border/50 pt-3')}>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Paused Work</p>
                            {pausedTimers.map(attempt => (
                                <div key={attempt.id} data-timer-paused={attempt.id} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 space-y-2">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">{attempt.clientName || 'Unassigned'}</p>
                                        <p className="text-xs text-muted-foreground truncate">{timerTaskLabel(attempt)} · {formatElapsed(getElapsedSeconds(attempt))}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        {!attempt.reviewingAt && (
                                            <button
                                                type="button"
                                                data-timer-resume={attempt.id}
                                                aria-label={`Resume ${timerTaskLabel(attempt)}`}
                                                onClick={() => void resume(attempt)}
                                                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
                                            >
                                                <Play className="h-3 w-3 fill-current" /> Resume
                                            </button>
                                        )}
                                        <button onClick={() => void openStopReview(attempt)} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/15 hover:text-red-400 transition-colors">
                                            <Square className="h-3 w-3 fill-current" /> {attempt.reviewingAt ? 'Review' : 'Stop'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {showNotes && runningTimer && (
                    <div className="border-t border-border/50 animate-in slide-in-from-top-1 fade-in duration-150">
                        <TimerNotes clients={clients} attemptId={runningTimer.id} notes={runningTimer.sessionNotes} />
                    </div>
                )}

                {stopError && (
                    <p role="alert" className="px-4 pb-2 text-xs text-destructive">{stopError}</p>
                )}

                <div className="px-4 pb-3">
                    <button onClick={() => setShowQuickStart(current => !current)} className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <Plus className="h-3 w-3" /> Switch client
                    </button>
                </div>
            </div>

            {showQuickStart && <div className="absolute bottom-full right-0 mb-2"><QuickStartPopover clients={clients} onClose={() => setShowQuickStart(false)} /></div>}
            {reviewAttemptId && <StopConfirmSheet attemptId={reviewAttemptId} onClose={() => setReviewAttemptId(null)} />}
        </div>
    );
}
