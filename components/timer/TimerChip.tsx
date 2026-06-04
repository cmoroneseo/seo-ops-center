'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Plus, RotateCcw, Clock } from 'lucide-react';
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
    const [showControls, setShowControls] = useState(false);
    const controlsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = () => setShowQuickStart(true);
        window.addEventListener('timer:open-quick-start', handler);
        return () => window.removeEventListener('timer:open-quick-start', handler);
    }, []);

    // Close controls popover on outside click
    useEffect(() => {
        if (!showControls) return;
        const handleClick = (e: MouseEvent) => {
            if (controlsRef.current && !controlsRef.current.contains(e.target as Node)) {
                setShowControls(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showControls]);

    // ── Session recovery ────────────────────────────────────────────────────
    if (isRecovering && recoveryTimer) {
        const h = Math.floor(recoveryTimer.elapsedSeconds / 3600);
        const m = Math.floor((recoveryTimer.elapsedSeconds % 3600) / 60);
        const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
        return (
            <div className="relative w-full px-1.5 mb-1">
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 animate-in fade-in slide-in-from-top-2 duration-300">
                    <p className="text-[9px] text-amber-500 font-semibold text-center leading-tight mb-1.5">
                        Timer left open<br />
                        <span className="font-normal opacity-80">{timeStr}</span>
                    </p>
                    <div className="flex gap-1">
                        <button
                            onClick={acceptRecovery}
                            className="flex-1 text-[9px] py-1 rounded-md bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors flex items-center justify-center gap-1"
                        >
                            <RotateCcw className="h-2 w-2" /> Keep
                        </button>
                        <button
                            onClick={dismissRecovery}
                            className="flex-1 text-[9px] py-1 rounded-md border border-border/60 text-muted-foreground hover:bg-muted transition-colors"
                        >
                            Drop
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Idle: compact play button ───────────────────────────────────────────
    if (!timer) {
        return (
            <div className="relative flex items-center justify-center mb-1">
                <button
                    onClick={() => setShowQuickStart(prev => !prev)}
                    title="Start Timer  ⌘⇧T"
                    className="group h-12 w-12 flex items-center justify-center rounded-xl text-muted-foreground hover:text-green-500 hover:bg-green-500/10 transition-all duration-200"
                >
                    <Clock className="h-5 w-5 group-hover:scale-110 transition-transform" />
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
        <div ref={controlsRef} className="relative flex items-center justify-center mb-1">
            {/* Compact pill button — click opens controls popover */}
            <button
                onClick={() => setShowControls(prev => !prev)}
                title={`${timer.clientName} — click for controls`}
                className={cn(
                    'relative flex flex-col items-center justify-center h-12 w-12 rounded-xl transition-all duration-200 overflow-hidden',
                    isRunning
                        ? 'bg-green-500/15 hover:bg-green-500/25 shadow-[0_0_10px_rgba(34,197,94,0.2)]'
                        : 'bg-amber-500/10 hover:bg-amber-500/20'
                )}
            >
                {/* Pulsing dot */}
                <span className={cn(
                    'block w-1.5 h-1.5 rounded-full mb-1',
                    isRunning ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
                )} />

                {/* Elapsed time */}
                <span className={cn(
                    'text-[10px] font-mono font-bold tabular-nums leading-none',
                    isRunning ? 'text-green-400' : 'text-amber-400'
                )}>
                    {formatElapsed(timer.elapsedSeconds)}
                </span>
            </button>

            {/* Controls popover — slides out to the right */}
            {showControls && !showQuickStart && (
                <div className="absolute left-14 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1 bg-popover border border-border rounded-xl shadow-xl px-2 py-2 animate-in fade-in slide-in-from-left-2 duration-150">
                    {/* Client name label */}
                    <span className="text-xs font-medium text-foreground max-w-[120px] truncate mr-1 pl-1">
                        {timer.clientName || 'Unassigned'}
                    </span>

                    <div className="w-px h-5 bg-border mx-0.5" />

                    {/* Pause / Resume */}
                    <button
                        onClick={() => { isRunning ? pause() : resume(); setShowControls(false); }}
                        title={isRunning ? 'Pause' : 'Resume'}
                        className={cn(
                            'h-7 w-7 flex items-center justify-center rounded-lg transition-colors',
                            isRunning
                                ? 'hover:bg-green-500/15 text-green-500'
                                : 'hover:bg-amber-500/15 text-amber-500'
                        )}
                    >
                        {isRunning
                            ? <Pause className="h-3.5 w-3.5 fill-current" />
                            : <Play className="h-3.5 w-3.5 fill-current" />
                        }
                    </button>

                    {/* Stop & log */}
                    <button
                        onClick={() => { setShowControls(false); setShowStopSheet(true); }}
                        title="Stop & Log"
                        className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                        <Square className="h-3.5 w-3.5 fill-current" />
                    </button>

                    {/* Switch client */}
                    <button
                        onClick={() => { setShowControls(false); setShowQuickStart(true); }}
                        title="Switch client"
                        className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

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
