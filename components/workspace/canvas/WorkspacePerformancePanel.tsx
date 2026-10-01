'use client';

import { useId } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChartPoint, Delta, PerformanceModel } from '@/lib/workspace-canvas/project';
import { formatDayLabel } from '@/lib/workspace-canvas/project';

function DeltaLine({ delta }: { delta: Delta }) {
    if (delta.kind === 'percent') {
        const pct = Math.round(delta.percent * 100);
        const up = pct >= 0;
        return <p className={up ? 'text-sm font-medium text-green-600 dark:text-green-400' : 'text-sm font-medium text-red-600 dark:text-red-400'}>{up ? 'Up' : 'Down'} {Math.abs(pct)}% vs the previous period</p>;
    }
    const label = delta.kind === 'no_baseline' ? 'No comparable baseline' : delta.kind === 'insufficient' ? 'Not enough coverage to compare' : 'Comparison unavailable';
    return <p className="text-sm text-muted-foreground">{label}</p>;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
    if (!active || !payload?.[0]) return null;
    const row = payload[0].payload;
    return (
        <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
            <p className="font-medium">{formatDayLabel(row.date)}</p>
            <p>Organic search clicks: {row.clicks == null ? 'Missing' : row.clicks.toLocaleString('en-US')}</p>
            {row.previousDate && <p>Previous {formatDayLabel(row.previousDate)}: {row.previousClicks == null ? 'Missing' : row.previousClicks.toLocaleString('en-US')}</p>}
        </div>
    );
}

export function WorkspacePerformancePanel({ model, reducedMotion }: { model: PerformanceModel; reducedMotion: boolean }) {
    const titleId = useId();
    const fillId = `search-fill-${titleId.replace(/[^a-zA-Z0-9]/g, '')}`;
    const clicks = model.clicks;
    const impressions = model.impressions;
    const summary = model.state === 'ready' && clicks
        ? `${clicks.label} ${clicks.total == null ? 'unavailable' : clicks.total} from ${model.rangeLabel}. ${model.message}`
        : model.message;

    return (
        <section aria-labelledby={titleId} className="min-w-0 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id={titleId} className="text-lg font-semibold tracking-tight">Search performance</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Google Search Console · Daily performance</p>
                </div>
                {model.rangeLabel && <p className="text-xs text-muted-foreground">{model.rangeLabel}</p>}
            </div>
            {model.state !== 'ready' || !clicks ? (
                <p role="status" className="mt-5 rounded-lg bg-muted/30 px-4 py-8 text-sm text-muted-foreground">{model.message}</p>
            ) : (
                <>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                            <p className="text-sm text-muted-foreground">{clicks.label}</p>
                            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{clicks.total == null ? '—' : clicks.total.toLocaleString('en-US')}</p>
                            <DeltaLine delta={clicks.delta} />
                        </div>
                        {impressions && (
                            <div>
                                <p className="text-sm text-muted-foreground">{impressions.label}</p>
                                <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{impressions.total == null ? '—' : impressions.total.toLocaleString('en-US')}</p>
                                <DeltaLine delta={impressions.delta} />
                            </div>
                        )}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">{model.property}{model.lastSync ? ` · Latest import ${new Date(model.lastSync).toLocaleString()}` : ' · No import timestamp'}</p>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-6 bg-chart-1" aria-hidden /> Organic search clicks</span>
                        {model.showPrevious && <span className="inline-flex items-center gap-2"><span className="h-0 w-6 border-t-2 border-dashed border-muted-foreground" aria-hidden /> Previous period</span>}
                    </div>
                    <div className="mt-3 h-[280px] min-h-[280px]" role="img" aria-label={summary}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={model.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.24} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
                                <CartesianGrid vertical={false} stroke="var(--border)" />
                                <XAxis axisLine={false} tickLine={false} dataKey="date" tickFormatter={value => String(value).slice(5)} stroke="var(--muted-foreground)" fontSize={11} minTickGap={28} />
                                <YAxis axisLine={false} tickLine={false} tickFormatter={value => Number(value) >= 1000 ? `${Number(value) / 1000}k` : String(value)} allowDecimals={false} width={36} stroke="var(--muted-foreground)" fontSize={11} />
                                <Tooltip content={<ChartTooltip />} />
                                <Area type="monotone" dataKey="clicks" name="Organic search clicks" stroke="var(--chart-1)" strokeWidth={2} fill={`url(#${fillId})`} connectNulls={false} dot={false} isAnimationActive={!reducedMotion} />
                                {model.showPrevious && <Line type="monotone" dataKey="previousClicks" name="Previous period" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="4 4" connectNulls={false} dot={false} isAnimationActive={!reducedMotion} />}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{model.message}</p>
                    <details className="mt-3 text-sm">
                        <summary className="cursor-pointer text-muted-foreground">View daily values</summary>
                        <div className="mt-2 max-h-48 overflow-auto">
                            <table className="w-full text-left text-sm">
                                <thead><tr><th scope="col" className="py-1 pr-3 font-medium">Date</th><th scope="col" className="py-1 pr-3 font-medium">Clicks</th>{model.showPrevious && <th scope="col" className="py-1 font-medium">Previous clicks</th>}</tr></thead>
                                <tbody>
                                    {model.points.map(row => (
                                        <tr key={row.date} className="border-t border-border/60">
                                            <td className="py-1 pr-3">{formatDayLabel(row.date)}</td>
                                            <td className="py-1 pr-3 tabular-nums">{row.clicks == null ? 'Missing' : row.clicks}</td>
                                            {model.showPrevious && <td className="py-1 tabular-nums">{row.previousDate ? (row.previousClicks == null ? `Missing (${formatDayLabel(row.previousDate)})` : row.previousClicks) : '—'}</td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </details>
                </>
            )}
        </section>
    );
}
