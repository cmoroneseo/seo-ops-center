'use client';

import { useState, useEffect } from 'react';
import { Play, Pause, Square, Plus, RotateCcw } from 'lucide-react';
import { useTimer } from '@/components/providers/timer-provider';
import { StopConfirmSheet } from './StopConfirmSheet';
import { QuickStartPopover } from './QuickStartPopover';
import { ClientProject } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatElapsed(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

interface TimerChipProps {
    clients: ClientProject[];
}

export function TimerChip({ clients }: TimerChipProps) {
    const { timer, pause, resume, isRecovering, recoveryTimer, acceptRecovery, dismissRecovery } = useTimer();
    const [showStopSheet, setShowStopSheet] = useState(false);
    const [showQuickStart, setShowQuickStart] = useState(false);

    useEffect(() => {
        const handler = () => setShowQuickStart(true);
        window.addEventListener('timer:open-quick-start', handler);
        return () => window.removeEventListener('timer:open-quick-start', handler);
    }, []);

    // ── Session recovery banner ─────────────────────────────────────────────
    if (isRecovering && recoveryTimer) {
        const h = Math.floor(recoveryTimer.elapsedSeconds / 3600);
        const m = Math.floor((recoveryTimer.elapsedSeconds % 3600) / 60);
        const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
        return (
            <div className="relative">
                <div className="mx-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 animate-in fade-in slide-in-from-top-2 duration-300">
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium leading-tight">
                        Timer was running ({timeStr})
                    </p>
                    <div className="flex gap-1.5 mt-1.5">
                        <button
                            onClick={acceptRecovery}
                            className="flex-1 text-[10px] py-1 rounded-md bg-amber-500 text-white font-medium hover:bg-amber-600 transition-colors flex items-center justify-center gap-1"
                        >
                            <RotateCcw className="h-2.5 w-2.5" /> Resume
                        </button>
                        <button
                            onClick={dismissRecovery}
                            className="flex-1 text-[10px] py-1 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
                        >
                            Discard
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Idle state: just show the + quick-add button ────────────────────────
    if (!timer) {
        return (
            <div className="relative flex flex-col items-center gap-1 mb-2">
                <button
                    onClick={() => setShowQuickStart(prev => !prev)}
                    title="Start Timer (⌘⇧T)"
                    className="h-10 w-10 flex items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground hover:border-green-500 hover:text-green-500 hover:bg-green-500/10 transition-all duration-200 group"
                >
                    <Play className="h-4 w-4 group-hover:scale-110 transition-transform" />
                </button>

                {showQuickStart && (
                    <QuickStartPopover
                        clients={clients}
                        onClose={() => setShowQuickStart(false)}
                    />
                )}
            </div>
        );
    }

    // ── Active timer ────────────────────────────────────────────────────────
    const isRunning = timer.status === 'running';

    return (
        <div className="relative flex flex-col items-center gap-1 mb-2 w-full px-2">
            {/* Main chip */}
            <div
                className={cn(
                    'w-full rounded-xl border transition-all duration-300 overflow-hidden',
                    isRunning
                        ? 'border-green-500/50 bg-green-500/10 shadow-[0_0_12px_rgba(34,197,94,0.15)]'
                        : 'border-amber-500/40 bg-amber-500/8'
                )}
            >
                {/* Animated top bar while running */}
                {isRunning && (
                    <div className="h-0.5 w-full bg-gradient-to-r from-green-500/0 via-green-500 to-green-500/0 animate-pulse" />
                )}

                <div className="px-2 py-1.5 flex flex-col items-center gap-1">
                    {/* Client name */}
                    <span
                        className={cn(
                            'text-[10px] font-medium truncate w-full text-center leading-tight',
                            isRunning ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
                        )}
                        title={timer.clientName}
                    >
                        {timer.clientName || 'Unassigned'}
                    </span>

                    {/* Elapsed time */}
                    <span className={cn(
                        'text-sm font-mono font-semibold tabular-nums',
                        isRunning ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'
                    )}>
                        {formatElapsed(timer.elapsedSeconds)}
                    </span>

                    {/* Controls */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                        {/* Pause / Resume */}
                        <button
                            onClick={isRunning ? pause : resume}
                            title={isRunning ? 'Pause' : 'Resume'}
                            className={cn(
                                'h-6 w-6 flex items-center justify-center rounded-lg transition-colors',
                                isRunning
                                    ? 'hover:bg-green-500/20 text-green-600 dark:text-green-400'
                                    : 'hover:bg-amber-500/20 text-amber-600 dark:text-amber-400'
                            )}
                        >
                            {isRunning
                                ? <Pause className="h-3 w-3 fill-current" />
                                : <Play className="h-3 w-3 fill-current" />
                            }
                        </button>

                        {/* Stop */}
                        <button
                            onClick={() => setShowStopSheet(true)}
                            title="Stop & Log"
                            className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-colors"
                        >
                            <Square className="h-3 w-3 fill-current" />
                        </button>

                        {/* New timer (start another for a different client) */}
                        <button
                            onClick={() => setShowQuickStart(prev => !prev)}
                            title="Switch client"
                            className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
                        >
                            <Plus className="h-3 w-3" />
                        </button>
                    </div>
                </div>
            </div>

            {showQuickStart && (
                <QuickStartPopover
                    clients={clients}
                    onClose={() => setShowQuickStart(false)}
                />
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
