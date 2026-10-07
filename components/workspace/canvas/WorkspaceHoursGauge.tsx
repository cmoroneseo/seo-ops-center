'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { HoursModel } from '@/lib/workspace-canvas/project';

function formatHours(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function WorkspaceHoursGauge({ model }: { model: HoursModel }) {
    const gauge = model.gauge;
    const number = gauge.logged != null && model.agreementRows?.length===1 ? formatHours(gauge.logged) : gauge.mode === 'arc' && gauge.logged != null ? formatHours(gauge.logged) : model.monthLogged != null && gauge.mode !== 'unavailable' ? formatHours(model.monthLogged) : null;

    const readoutClass = `${number ?? '—'} / ${gauge.budget == null ? '' : formatHours(gauge.budget)}`.length > 7 ? 'text-2xl' : 'text-3xl';

    return (
        <section aria-labelledby="workspace-hours-heading" className="rounded-xl border border-border bg-card p-4">
            <h2 id="workspace-hours-heading" className="text-lg font-semibold tracking-tight">{model.kind === 'monthly' ? 'Monthly hours' : model.label}</h2>
            {model.agreementRows && (model.agreementRows.length>1 || (model.unassignedHours ?? 0)>0) ? <div className="mt-4 space-y-3">{model.agreementRows.map(row=><div key={row.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3"><div><p className="text-sm font-medium">{row.title}</p><p className="mt-1 text-xs text-muted-foreground">{row.label} · {row.unit}</p></div><p className="text-sm font-semibold tabular-nums">{formatHours(row.logged)}{row.budget!=null && ` / ${formatHours(row.budget)}`}h</p></div>)}{(model.unassignedHours ?? 0)>0 && <p className="text-sm text-muted-foreground">{formatHours(model.unassignedHours!)}h needs scope review.</p>}<Link href="/timesheets" className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-4">View time details <ArrowRight className="h-3.5 w-3.5" /></Link></div> : <>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="relative h-[124px] w-36 shrink-0">
                    <svg viewBox="0 0 140 120" className="h-full w-full" role="img" aria-label={`${model.label}: ${number ?? 'unavailable'} of ${gauge.budget ?? 'no'} budget`}>
                        <path d="M 17.4 95.2 A 56 56 0 1 1 122.6 95.2" fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
                        {gauge.mode === 'arc' && gauge.arc != null && gauge.arc > 0 && <path d="M 17.4 95.2 A 56 56 0 1 1 122.6 95.2" pathLength="100" fill="none" stroke={gauge.over ? 'var(--destructive)' : 'var(--chart-1)'} strokeWidth="10" strokeDasharray={`${gauge.arc * 100} 100`} strokeLinecap="round" />}
                    </svg>
                    <div className="absolute inset-x-0 top-[52%] flex flex-col items-center gap-0.5">
                        <p className={`${readoutClass} leading-none font-semibold tabular-nums`}>{number ?? '—'}{gauge.budget != null && <span className="text-base font-medium text-muted-foreground"> / {formatHours(gauge.budget)}</span>}</p>
                        <p className="text-xs text-muted-foreground">hours</p>
                    </div>
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                    <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-chart-1" /><span className="font-semibold tabular-nums text-foreground">{number ?? '—'}</span> Logged</p>
                    {gauge.budget != null && gauge.logged != null && <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground" /><span className="font-semibold tabular-nums text-foreground">{formatHours(Math.max(0, gauge.budget - gauge.logged))}</span> Remaining</p>}
                    {!['Logged', 'Campaign total', 'Tracked'].includes(model.status) && <p className="font-medium text-foreground">{model.status}</p>}
                    <Link href="/timesheets" className="mt-4 inline-flex items-center gap-1.5 rounded text-xs font-semibold text-primary underline underline-offset-4 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring">View time details <ArrowRight className="h-3.5 w-3.5" /></Link>
                </div>
            </div>
            </>}
            {gauge.over && gauge.logged != null && gauge.budget != null && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">Over budget: {formatHours(gauge.logged)} of {formatHours(gauge.budget)}. The arc is full; the number is the actual total.</p>
            )}
            {model.detail !== 'Confirmed hours that count toward the monthly budget.' && <p className="mt-2 text-xs text-muted-foreground">{model.detail}</p>}
            {model.monthUnavailable && <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">Selected-month hours could not be loaded.</p>}
        </section>
    );
}
