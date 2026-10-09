'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import { Globe, MapPin } from 'lucide-react';

import { chartAnnouncement, type ChartModel } from '@/lib/search-insights/view';
import { InsightTable, useSurfaceColors } from './bits';

export { useSurfaceColors };

function parseCell(value: string | undefined): number | null {
    if (!value || value === '—') return null;
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

export function SurfaceCharts({ chart }: { chart: ChartModel }) {
    const colors = useSurfaceColors();
    const hatchId = `insights-hatch-${useId().replace(/:/g, '')}`;
    const [asTable, setAsTable] = useState(false);
    const [index, setIndex] = useState(0);
    const [panelIndex, setPanelIndex] = useState(0);
    const panel = chart.panels[Math.min(panelIndex, chart.panels.length - 1)];
    const date = chart.dates[index];
    const row = chart.rows[index];
    const impressions = panel?.id === 'map' ? row?.map : row?.organic;
    const announcement = date ? chartAnnouncement(date.label, date.status, parseCell(impressions)) : '';

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            setIndex(current => Math.min(chart.dates.length - 1, current + 1));
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            setIndex(current => Math.max(0, current - 1));
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setPanelIndex(current => (event.key === 'ArrowDown' ? Math.min(chart.panels.length - 1, current + 1) : Math.max(0, current - 1)));
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5" aria-hidden="true" />Organic</span>
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Map pack</span>
                </div>
                <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-xs text-foreground"
                    aria-pressed={asTable}
                    onClick={() => setAsTable(current => !current)}
                >
                    View as table
                </button>
            </div>
            {chart.capLabel ? (
                <p className="rounded-md border border-amber-500/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{chart.capLabel}</p>
            ) : null}
            <div
                role="group"
                tabIndex={0}
                aria-label="Daily impressions. Left and right move one day. Up and down switch Organic and Map pack."
                className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={onKeyDown}
            >
                <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-auto w-full" aria-hidden="true">
                    <defs>
                        <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted-foreground)" strokeOpacity="0.55" strokeWidth="1" />
                        </pattern>
                    </defs>
                    {chart.panels.map(item => {
                        const stroke = item.colorToken === 'organic' ? colors.organic : colors.map;
                        return (
                            <g key={item.id}>
                                <text x="4" y={item.top + 12} fill="var(--muted-foreground)" fontSize="11">{item.label}</text>
                                {item.hatch.map(rect => (
                                    <rect key={`${item.id}-${rect.x}`} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={`url(#${hatchId})`} />
                                ))}
                                {item.ticks.map(tick => (
                                    <g key={`${item.id}-${tick.label}-${tick.y}`}>
                                        <line x1="48" x2={chart.width - 12} y1={tick.y} y2={tick.y} stroke="var(--border)" strokeWidth="1" />
                                        <text x="4" y={tick.y + 4} fill="var(--muted-foreground)" fontSize="10">{tick.label}</text>
                                    </g>
                                ))}
                                {item.solid ? <path d={item.solid} fill="none" stroke={stroke} strokeWidth="2" /> : null}
                                {item.dashed ? <path d={item.dashed} fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="4 3" /> : null}
                                {item.points[index] && item.points[index].y != null ? (
                                    <circle cx={item.points[index].x} cy={item.points[index].y ?? 0} r={item.id === panel?.id ? 4 : 2.5} fill={stroke} />
                                ) : null}
                                {!item.drawn ? (
                                    <text x="56" y={item.top + 72} fill="var(--foreground)" fontSize="13">
                                        {item.zeroValue ? `${item.zeroValue}. ${item.zeroCopy ?? ''}` : item.unavailable}
                                    </text>
                                ) : null}
                            </g>
                        );
                    })}
                    {chart.labels.map(label => (
                        <text key={label.text} x={label.x} y={chart.height - 6} fill="var(--muted-foreground)" fontSize="11" textAnchor="middle">{label.text}</text>
                    ))}
                </svg>
                <p className="mt-2 text-sm text-foreground" aria-live="polite">{announcement}</p>
            </div>
            {chart.note ? <p className="text-xs text-muted-foreground">{chart.note}</p> : null}
            {asTable ? (
                <InsightTable label="Daily impressions" head={['Date', 'Status', 'Organic impressions', 'Map pack impressions']}>
                    {chart.rows.map(item => (
                        <tr key={item.date} className="border-b border-border">
                            <th scope="row" className="px-3 py-2 font-medium">{item.label}</th>
                            <td className="px-3 py-2">{item.status}</td>
                            <td className="px-3 py-2 tabular-nums">{item.organic}</td>
                            <td className="px-3 py-2 tabular-nums">{item.map}</td>
                        </tr>
                    ))}
                </InsightTable>
            ) : null}
        </div>
    );
}
