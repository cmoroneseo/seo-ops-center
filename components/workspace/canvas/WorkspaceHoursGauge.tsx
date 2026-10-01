'use client';

import type { HoursModel } from '@/lib/workspace-canvas/project';

function formatHours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function WorkspaceHoursGauge({ model, onViewTime }: { model: HoursModel; onViewTime: () => void }) {
    const gauge = model.gauge;
    const number = gauge.mode === 'arc' && gauge.logged != null ? formatHours(gauge.logged) : model.monthLogged != null && gauge.mode !== 'unavailable' ? formatHours(model.monthLogged) : null;

    return (
        <section aria-labelledby="workspace-hours-heading" className="rounded-xl border border-border bg-card p-5">
            <h2 id="workspace-hours-heading" className="text-lg font-semibold tracking-tight">{model.label}</h2>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="relative h-24 w-36 shrink-0">
                    <svg viewBox="0 0 140 100" className="h-full w-full" role="img" aria-label={`${model.label}: ${number ?? 'unavailable'} of ${gauge.budget ?? 'no'} budget`}>
                        <path d="M 18 82 A 52 52 0 0 1 122 82" fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
                        {gauge.mode === 'arc' && gauge.arc != null && gauge.arc > 0 && <path d="M 18 82 A 52 52 0 0 1 122 82" pathLength="100" fill="none" stroke={gauge.over ? 'var(--destructive)' : 'var(--chart-1)'} strokeWidth="10" strokeDasharray={`${gauge.arc * 100} 100`} strokeLinecap="round" />}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
                        <p className="text-3xl font-semibold tabular-nums">{number ?? '—'}{gauge.budget != null && <span className="text-base text-muted-foreground"> / {formatHours(gauge.budget)}</span>}</p>
                        <p className="text-xs text-muted-foreground">hours</p>
                    </div>
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                    <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-chart-1" />{number ?? '—'} logged</p>
                    {gauge.budget != null && gauge.logged != null && <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-muted-foreground" />{formatHours(Math.max(0, gauge.budget - gauge.logged))} remaining</p>}
                    <p className="font-medium text-foreground">{model.status}</p>
                </div>
            </div>
            {gauge.over && gauge.logged != null && gauge.budget != null && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">Over budget: {formatHours(gauge.logged)} of {formatHours(gauge.budget)}. The arc is full; the number is the actual total.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{model.detail}</p>
            {model.monthUnavailable && <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">Selected-month hours could not be loaded.</p>}
            <button type="button" onClick={onViewTime} className="mt-3 rounded-md py-1 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View time details</button>
        </section>
    );
}
