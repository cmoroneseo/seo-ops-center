'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, Pause, Play, Plus, Square } from 'lucide-react';
import { useTimer } from '@/components/providers/timer-provider';
import { StopConfirmSheet } from './StopConfirmSheet';
import { QuickStartPopover } from './QuickStartPopover';
import type { ClientProject, TimerAttempt } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatElapsed(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function TimerChip({ clients }: { clients: ClientProject[] }) {
    const { runningTimer, pausedTimers, getElapsedSeconds, pause, resume, beginStop } = useTimer();
    const [showStopSheet, setShowStopSheet] = useState(false);
    const [reviewTimer, setReviewTimer] = useState<TimerAttempt | null>(null);
    const [showQuickStart, setShowQuickStart] = useState(false);
    const [showControls, setShowControls] = useState(false);
    const controlsRef = useRef<HTMLDivElement>(null);
    const primaryTimer = runningTimer ?? pausedTimers[0] ?? null;

    useEffect(() => {
        const handler = () => setShowQuickStart(true);
        window.addEventListener('timer:open-quick-start', handler);
        return () => window.removeEventListener('timer:open-quick-start', handler);
    }, []);

    useEffect(() => {
        if (!showControls) return;
        const handleClick = (event: MouseEvent) => {
            if (controlsRef.current && !controlsRef.current.contains(event.target as Node)) setShowControls(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showControls]);

    const openStopReview = async (attempt: TimerAttempt) => {
        const state = attempt.reviewingAt ? null : await beginStop(attempt);
        setReviewTimer(state?.paused.find(item => item.id === attempt.id) ?? attempt);
        setShowStopSheet(true);
    };

    if (!primaryTimer) {
        return (
            <div className="relative flex items-center justify-center mb-1">
                <button onClick={() => setShowQuickStart(current => !current)} title="Start Timer  ⌘⇧T" className="group h-12 w-12 flex items-center justify-center rounded-xl text-muted-foreground hover:text-green-500 hover:bg-green-500/10 transition-all duration-200">
                    <Clock className="h-5 w-5 group-hover:scale-110 transition-transform" />
                </button>
                {showQuickStart && <QuickStartPopover clients={clients} onClose={() => setShowQuickStart(false)} />}
            </div>
        );
    }

    const isRunning = primaryTimer.id === runningTimer?.id;
    return (
        <div ref={controlsRef} className="relative flex items-center justify-center mb-1">
            <button onClick={() => setShowControls(current => !current)} title={`${primaryTimer.clientName || 'Unassigned'} — click for controls`} className={cn('relative flex flex-col items-center justify-center h-12 w-12 rounded-xl transition-all duration-200 overflow-hidden', isRunning ? 'bg-green-500/15 hover:bg-green-500/25 shadow-[0_0_10px_rgba(34,197,94,0.2)]' : 'bg-amber-500/10 hover:bg-amber-500/20')}>
                <span className={cn('block w-1.5 h-1.5 rounded-full mb-1', isRunning ? 'bg-green-500 animate-pulse' : 'bg-amber-500')} />
                <span className={cn('text-[10px] font-mono font-bold tabular-nums leading-none', isRunning ? 'text-green-400' : 'text-amber-400')}>{formatElapsed(getElapsedSeconds(primaryTimer))}</span>
            </button>

            {showControls && !showQuickStart && (
                <div className="absolute left-14 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1 bg-popover border border-border rounded-xl shadow-xl px-2 py-2 animate-in fade-in slide-in-from-left-2 duration-150">
                    <span className="text-xs font-medium text-foreground max-w-[120px] truncate mr-1 pl-1">{primaryTimer.clientName || 'Unassigned'}</span>
                    <div className="w-px h-5 bg-border mx-0.5" />
                    {!primaryTimer.reviewingAt && <button onClick={() => { void (isRunning ? pause(primaryTimer) : resume(primaryTimer)); setShowControls(false); }} title={isRunning ? 'Pause' : 'Resume'} className={cn('h-7 w-7 flex items-center justify-center rounded-lg transition-colors', isRunning ? 'hover:bg-green-500/15 text-green-500' : 'hover:bg-amber-500/15 text-amber-500')}>
                        {isRunning ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                    </button>}
                    <button onClick={() => { setShowControls(false); void openStopReview(primaryTimer); }} title="Stop & Log" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors"><Square className="h-3.5 w-3.5 fill-current" /></button>
                    <button onClick={() => { setShowControls(false); setShowQuickStart(true); }} title="Switch client" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors"><Plus className="h-3.5 w-3.5" /></button>
                </div>
            )}
            {showQuickStart && <QuickStartPopover clients={clients} onClose={() => setShowQuickStart(false)} />}
            {showStopSheet && reviewTimer && <StopConfirmSheet timer={reviewTimer} onClose={() => { setShowStopSheet(false); setReviewTimer(null); }} />}
        </div>
    );
}
