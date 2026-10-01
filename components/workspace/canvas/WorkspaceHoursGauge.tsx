'use client';

import type { HoursModel } from '@/lib/workspace-canvas/project';

function formatHours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function WorkspaceHoursGauge({ model, onViewTime }: { model: HoursModel; onViewTime: () => void }) {
    const gauge = model.gauge;
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const visible = circumference * 0.75;
    const progress = gauge.arc == null ? 0 : gauge.arc * visible;
    const number = gauge.mode === 'arc' && gauge.logged != null ? formatHours(gauge.logged) : model.monthLogged != null && gauge.mode !== 'unavailable' ? formatHours(model.monthLogged) : null;

    return (
        <section aria-labelledby="workspace-hours-heading" className="rounded-xl border border-border bg-card p-5">
            <h2 id="workspace-hours-heading" className="text-sm font-medium text-muted-foreground">{model.label}</h2>
            <div className="relative mx-auto mt-2 h-36 w-40">
                <svg viewBox="0 0 140 120" className="h-full w-full" role="img" aria-label={gauge.mode === 'unavailable' ? 'Hours unavailable' : `${model.label}: ${number ?? 'no hours'} of ${gauge.budget ?? 'no'} budget`}>
                    <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--border)" strokeWidth="10" strokeDasharray={`${visible} ${circumference}`} strokeLinecap="round" transform="rotate(135 70 70)" />
                    {gauge.mode === 'arc' && (
                        <circle cx="70" cy="70" r={radius} fill="none" stroke={gauge.over ? 'var(--destructive)' : 'var(--chart-1)'} strokeWidth="10" strokeDasharray={`${progress} ${circumference}`} strokeLinecap="round" transform="rotate(135 70 70)" />
                    )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
                    <p className="text-3xl font-semibold tabular-nums">{number ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{gauge.budget ? `/ ${formatHours(gauge.budget)}` : model.status}</p>
                </div>
            </div>
            <p className="text-center text-sm font-medium">{model.status}</p>
            {gauge.over && gauge.logged != null && gauge.budget != null && (
                <p className="mt-1 text-center text-sm text-red-600 dark:text-red-400">Over budget: {formatHours(gauge.logged)} of {formatHours(gauge.budget)}. The arc is full; the number is the actual total.</p>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">{model.detail}</p>
            {model.monthUnavailable && <p role="status" className="mt-2 text-center text-xs text-amber-700 dark:text-amber-400">Selected-month hours could not be loaded.</p>}
            <button type="button" onClick={onViewTime} className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View time details</button>
        </section>
    );
}
