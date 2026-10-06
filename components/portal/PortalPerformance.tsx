'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monthLabel } from '@/lib/reports/sections';
import { percentChange, type PortalPerformanceMonth } from '@/lib/portal/dashboard';

function Change({ current, previous }: { current: number | null; previous: number | null }) {
    const delta = percentChange(current, previous);
    if (delta === null) return <span className="text-[11px] text-muted-foreground">No prior comparison</span>;
    const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;
    return <span className={`inline-flex items-center gap-1 text-xs font-bold ${delta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}><Icon size={17} aria-hidden="true" />{delta > 0 ? '+' : ''}{delta}%</span>;
}

export function PortalPerformance({ months }: { months: PortalPerformanceMonth[] }) {
    const [selected, setSelected] = useState(months[0]?.month ?? '');
    const active = months.find(item => item.month === selected) ?? months[0];
    const history = [...months].filter(item => item.month <= (active?.month ?? '')).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
    const hasData = active && (active.clicks !== null || active.impressions !== null);
    return (
        <section className="portal-panel" aria-labelledby="search-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 id="search-heading">Search performance</h2><p className="portal-panel-description">Organic search results from Google Search Console</p></div>
                {months.length > 0 && <label className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs"><CalendarDays size={14} aria-hidden="true" /><span className="sr-only">Search performance report month</span><select className="max-w-40 bg-card pr-1 text-xs" value={selected} onChange={event => setSelected(event.target.value)}>{months.map(item => <option key={item.month} value={item.month}>{monthLabel(item.month)}</option>)}</select></label>}
            </div>
            {hasData ? <>
                <div className="portal-metric-grid" aria-live="polite">
                    <div><p className="text-xs font-semibold">Organic search clicks</p><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><p className="portal-metric-value">{active.clicks?.toLocaleString('en-US') ?? '—'}</p><Change current={active.clicks} previous={active.previousClicks} /></div><p className="mt-1 text-[10px] text-muted-foreground">vs. previous calendar month</p></div>
                    <div><p className="text-xs font-semibold">Search impressions</p><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><p className="portal-metric-value">{active.impressions?.toLocaleString('en-US') ?? '—'}</p><Change current={active.impressions} previous={active.previousImpressions} /></div><p className="mt-1 text-[10px] text-muted-foreground">vs. previous calendar month</p></div>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-chart-1" />Monthly clicks · shared reports</span><Link className="text-primary hover:underline" href={`/portal/reports/${active.reportId}`}>View full report →</Link></div>
                <div className="mt-3 h-[170px] w-full" role="img" aria-label={`Monthly organic search clicks across ${history.length} shared reports. Data available in the table below.`}>
                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 500, height: 170 }}><AreaChart data={history} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="month" tickFormatter={value => new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                        <Tooltip labelFormatter={label => monthLabel(String(label))} contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: 'var(--border)', color: 'var(--popover-foreground)', backgroundColor: 'var(--popover)' }} />
                        <Area type="linear" dataKey="clicks" name="Organic clicks" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.1} strokeWidth={2.5} dot={{ r: 3, fill: 'var(--chart-1)' }} connectNulls={false} isAnimationActive={false} />
                    </AreaChart></ResponsiveContainer>
                </div>
                <details className="mt-2 text-[10px] text-muted-foreground"><summary>View search data</summary><table className="mt-2 w-full text-left text-xs"><caption className="sr-only">Search results from shared monthly reports</caption><thead><tr><th className="py-2">Month</th><th>Clicks</th><th>Impressions</th></tr></thead><tbody>{history.map(item => <tr key={item.month} className="border-t border-border"><td className="py-2">{monthLabel(item.month)}</td><td>{item.clicks?.toLocaleString('en-US') ?? 'Unavailable'}</td><td>{item.impressions?.toLocaleString('en-US') ?? 'Unavailable'}</td></tr>)}</tbody></table></details>
            </> : <div className="portal-empty flex min-h-[255px] flex-col items-center justify-center"><ChartNoAxesCombined size={34} className="mb-3 text-primary" aria-hidden="true" /><p className="font-semibold text-foreground">{active ? 'Search data is not available for this report' : 'Your search story starts here'}</p><p className="mt-2 max-w-sm">{active ? 'You can still open the full report for the results your team has shared.' : 'Once your team shares a report, you’ll see clicks, impressions, and month-over-month progress here.'}</p><Link href={active ? `/portal/reports/${active.reportId}` : '/portal/reports'} className="mt-4 text-xs font-semibold text-primary hover:underline">{active ? 'Open report' : 'Go to reports'} →</Link></div>}
        </section>
    );
}
