'use client';

import { formatAttemptClock, type OpenTimerRow } from '@/lib/timer/attempt-state';

const PHASE_LABEL = {
    running: 'Running',
    paused: 'Paused',
    reviewing: 'In review',
} as const;

/** Open or paused attempts, with Resume, so Start can be checked first. */
export function OpenTimerStrip({
    rows,
    onResume,
}: {
    rows: readonly OpenTimerRow[];
    onResume: (attemptId: string) => void;
}) {
    if (rows.length === 0) return null;
    return (
        <section
            aria-label="Open timers"
            data-open-timers
            className="mb-3 rounded-lg border border-border bg-card px-3 py-2"
        >
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Open timers</p>
            <ul className="mt-1 space-y-1">
                {rows.map(row => (
                    <li key={row.attemptId} data-open-timer={row.attemptId} className="flex items-center gap-2 text-sm">
                        <span
                            data-open-timer-phase={row.phase}
                            className={row.phase === 'running'
                                ? 'shrink-0 rounded-full bg-[#ec4899]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#ec4899]'
                                : row.phase === 'paused'
                                    ? 'shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-500'
                                    : 'shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground'}
                        >
                            {PHASE_LABEL[row.phase]}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground">{row.title}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatAttemptClock(row.seconds)}</span>
                        {row.phase === 'paused' && (
                            <button
                                type="button"
                                data-open-timer-resume={row.attemptId}
                                onClick={() => onResume(row.attemptId)}
                                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-amber-500 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                            >
                                Resume
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
