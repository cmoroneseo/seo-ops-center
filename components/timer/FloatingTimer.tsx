'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Plus, RotateCcw, Clock, ChevronDown, StickyNote } from 'lucide-react';
import { useTimer } from '@/components/providers/timer-provider';
import { StopConfirmSheet } from './StopConfirmSheet';
import { QuickStartPopover } from './QuickStartPopover';
import { TimerNotes } from './TimerNotes';
import { ClientProject } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatElapsed(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

interface FloatingTimerProps {
    clients: ClientProject[];
}

export function FloatingTimer({ clients }: FloatingTimerProps) {
    const { timer, notes, pause, resume, isRecovering, recoveryTimer, acceptRecovery, dismissRecovery } = useTimer();
    const [expanded, setExpanded] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [showStopSheet, setShowStopSheet] = useState(false);
    const [showQuickStart, setShowQuickStart] = useState(false);
    const widgetRef = useRef<HTMLDivElement>(null);

    // Open quick-start via keyboard shortcut
    useEffect(() => {
        const handler = () => setShowQuickStart(true);
        window.addEventListener('timer:open-quick-start', handler);
        return () => window.removeEventListener('timer:open-quick-start', handler);
    }, []);

    // Auto-expand when a timer starts
    useEffect(() => {
        if (timer) setExpanded(true);
    }, [!!timer]);

    // Close expanded card on outside click
    useEffect(() => {
        if (!expanded) return;
        const handleClick = (e: MouseEvent) => {
            if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
                setExpanded(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [expanded]);

    const isRunning = timer?.status === 'running';

    // ── Session recovery card ───────────────────────────────────────────────
    if (isRecovering && recoveryTimer) {
        const h = Math.floor(recoveryTimer.elapsedSeconds / 3600);
        const m = Math.floor((recoveryTimer.elapsedSeconds % 3600) / 60);
        const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

        return (
            <div className="fixed bottom-6 right-6 z-50 w-72 animate-in slide-in-from-bottom-4 fade-in duration-300">
                <div className="bg-card border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden">
                    <div className="h-1 w-full bg-amber-500/60" />
                    <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                            <span className="text-sm font-semibold text-foreground">Timer still open</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            You had a timer running for <span className="font-medium text-foreground">{timeStr}</span>. What would you like to do?
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={acceptRecovery}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors"
                            >
                                <RotateCcw className="h-3 w-3" /> Resume
                            </button>
                            <button
                                onClick={dismissRecovery}
                                className="flex-1 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
                            >
                                Discard
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Idle state: subtle clock button ────────────────────────────────────
    if (!timer) {
        return (
            <div ref={widgetRef} className="fixed bottom-6 right-6 z-50">
                <div className="relative">
                    <button
                        onClick={() => setShowQuickStart(prev => !prev)}
                        title="Start Timer  ⌘⇧T"
                        className="group h-14 w-14 flex items-center justify-center rounded-full bg-card border border-border shadow-lg hover:border-green-500/50 hover:bg-green-500/10 hover:shadow-green-500/10 transition-all duration-200"
                    >
                        <Clock className="h-5 w-5 text-muted-foreground group-hover:text-green-500 transition-colors" />
                    </button>

                    {showQuickStart && (
                        <div className="absolute bottom-16 right-0">
                            <QuickStartPopover
                                clients={clients}
                                onClose={() => setShowQuickStart(false)}
                            />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Active: minimized pill ──────────────────────────────────────────────
    if (!expanded) {
        return (
            <div className="fixed bottom-6 right-6 z-50">
                <button
                    onClick={() => setExpanded(true)}
                    className={cn(
                        'group flex items-center gap-2.5 pl-3 pr-4 h-12 rounded-full shadow-lg border transition-all duration-200 hover:scale-105',
                        isRunning
                            ? 'bg-card border-green-500/40 shadow-green-500/10 hover:border-green-500/70'
                            : 'bg-card border-amber-500/30 shadow-amber-500/10 hover:border-amber-500/60'
                    )}
                >
                    <span className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        isRunning ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
                    )} />
                    <span className={cn(
                        'font-mono font-semibold text-sm tabular-nums',
                        isRunning ? 'text-green-400' : 'text-amber-400'
                    )}>
                        {formatElapsed(timer.elapsedSeconds)}
                    </span>
                </button>
            </div>
        );
    }

    // ── Active: expanded card ───────────────────────────────────────────────
    return (
        <div ref={widgetRef} className="fixed bottom-6 right-6 z-50 w-72 animate-in slide-in-from-bottom-3 fade-in duration-200">
            <div className={cn(
                'bg-card border rounded-2xl shadow-2xl overflow-hidden',
                isRunning ? 'border-green-500/30 shadow-green-500/5' : 'border-amber-500/30'
            )}>
                {/* Animated top accent bar */}
                <div className={cn(
                    'h-0.5 w-full',
                    isRunning
                        ? 'bg-gradient-to-r from-green-500/0 via-green-500 to-green-500/0 animate-pulse'
                        : 'bg-amber-500/60'
                )} />

                <div className="px-4 pt-4 pb-2 space-y-3">
                    {/* Header row: status + collapse */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className={cn(
                                'h-2 w-2 rounded-full shrink-0',
                                isRunning ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
                            )} />
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                {isRunning ? 'Tracking' : 'Paused'}
                            </span>
                        </div>
                        <button
                            onClick={() => setExpanded(false)}
                            className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                            <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {/* Client name */}
                    <div>
                        <p className="font-semibold text-foreground truncate">{timer.clientName || 'Unassigned'}</p>
                        {timer.taskTitle && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{timer.taskTitle}</p>
                        )}
                    </div>

                    {/* Big elapsed time */}
                    <div className={cn(
                        'text-4xl font-mono font-bold tabular-nums tracking-tight',
                        isRunning ? 'text-green-400' : 'text-amber-400'
                    )}>
                        {formatElapsed(timer.elapsedSeconds)}
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-2 pt-1">
                        {/* Pause / Resume */}
                        <button
                            onClick={isRunning ? pause : resume}
                            className={cn(
                                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                                isRunning
                                    ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                                    : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                            )}
                        >
                            {isRunning
                                ? <><Pause className="h-4 w-4 fill-current" /> Pause</>
                                : <><Play className="h-4 w-4 fill-current" /> Resume</>
                            }
                        </button>

                        {/* Stop & Log */}
                        <button
                            onClick={() => { setExpanded(false); setShowStopSheet(true); }}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted text-sm font-medium text-muted-foreground hover:bg-destructive/15 hover:text-red-400 transition-all duration-150"
                        >
                            <Square className="h-4 w-4 fill-current" /> Stop
                        </button>
                    </div>

                    {/* Notes toggle */}
                    <button
                        onClick={() => setShowNotes(prev => !prev)}
                        className={cn(
                            'w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs transition-colors',
                            showNotes
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        )}
                    >
                        <StickyNote className="h-3 w-3" />
                        Session Notes
                        {notes.length > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold leading-none">
                                {notes.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Expandable notes panel */}
                {showNotes && (
                    <div className="border-t border-border/50 animate-in slide-in-from-top-1 fade-in duration-150">
                        <TimerNotes clients={clients} notes={notes} />
                    </div>
                )}

                {/* Switch client */}
                <div className="px-4 pb-3">
                    <button
                        onClick={() => setShowQuickStart(prev => !prev)}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <Plus className="h-3 w-3" /> Switch client
                    </button>
                </div>
            </div>

            {showQuickStart && (
                <div className="absolute bottom-full right-0 mb-2">
                    <QuickStartPopover
                        clients={clients}
                        onClose={() => setShowQuickStart(false)}
                    />
                </div>
            )}

            {showStopSheet && (
                <StopConfirmSheet
                    timer={timer}
                    onClose={() => setShowStopSheet(false)}
                />
            )}
        </div>
    );
}
