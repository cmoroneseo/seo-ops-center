'use client';

import { useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { botBadgeLabel, type BotTimerClock } from '@/lib/timer/bot-display';
import { cn } from '@/lib/utils';

function formatElapsed(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

/**
 * One bot timer, drawn like a timer a person started.
 * The badge says which bot owns it. Pause, resume, and stop call the caller.
 */
export function BotTimerChip({
    timer,
    seconds,
    pending = false,
    onPause,
    onResume,
    onStop,
}: {
    timer: BotTimerClock;
    seconds: number;
    pending?: boolean;
    onPause: (timeLogId: string) => void;
    onResume: (timeLogId: string) => void;
    onStop: (timeLogId: string) => void;
}) {
    const [confirmStop, setConfirmStop] = useState(false);
    const running = timer.phase === 'running';
    const badge = botBadgeLabel(timer.botName);
    const title = timer.taskTitle || 'Task';

    return (
        <div
            data-bot-timer={timer.id}
            data-bot-phase={timer.phase}
            className={cn(
                'w-72 rounded-2xl border bg-card px-4 py-3 shadow-lg',
                running ? 'border-[#ec4899]/40 shadow-[#ec4899]/10' : 'border-amber-500/40',
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-[#ec4899] animate-pulse' : 'bg-amber-500')} />
                    {running ? 'Tracking' : 'Paused'}
                </span>
                <span data-bot-badge className="rounded-full bg-[#ec4899]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#ec4899]">
                    {badge}
                </span>
            </div>
            <p className="mt-1 truncate text-sm font-medium text-foreground">{timer.clientName || 'Client'}</p>
            <p data-bot-task className="truncate text-xs text-muted-foreground">{title}</p>
            <p className={cn('mt-1 font-mono text-2xl font-semibold tabular-nums', running ? 'text-[#ec4899]' : 'text-amber-500')}>
                {formatElapsed(seconds)}
            </p>
            <div className="mt-2 flex gap-2">
                {running ? (
                    <button
                        type="button"
                        disabled={pending}
                        data-bot-pause={timer.id}
                        onClick={() => onPause(timer.id)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#ec4899]/15 py-2 text-sm font-medium text-[#ec4899] hover:bg-[#ec4899]/25 disabled:opacity-70"
                    >
                        <Pause className="h-3.5 w-3.5 fill-current" /> Pause
                    </button>
                ) : (
                    <button
                        type="button"
                        disabled={pending}
                        data-bot-resume={timer.id}
                        onClick={() => onResume(timer.id)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500/15 py-2 text-sm font-medium text-amber-500 hover:bg-amber-500/25 disabled:opacity-70"
                    >
                        <Play className="h-3.5 w-3.5 fill-current" /> Resume
                    </button>
                )}
                {confirmStop ? (
                    <button
                        type="button"
                        disabled={pending}
                        data-bot-stop={timer.id}
                        onClick={() => {
                            setConfirmStop(false);
                            onStop(timer.id);
                        }}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-destructive/15 py-2 text-sm font-medium text-red-400"
                    >
                        Stop and save
                    </button>
                ) : (
                    <button
                        type="button"
                        disabled={pending}
                        data-bot-stop-ask={timer.id}
                        onClick={() => setConfirmStop(true)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-muted py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/15 hover:text-red-400"
                    >
                        <Square className="h-3.5 w-3.5 fill-current" /> Stop
                    </button>
                )}
            </div>
        </div>
    );
}
