'use client';

import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { drawsBothAxes, pointValue, seriesLegend, type ChartPoint, type ChartSeries } from '@/lib/search-dashboard/model';

export function DashboardChart({
    points,
    series,
    label,
}: {
    points: ChartPoint[];
    series: ChartSeries[];
    label: string;
}) {
    const frame = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const node = frame.current;
        if (!node) return;
        const measure = () => setWidth(node.clientWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    const dual = drawsBothAxes(series);
    const left = series.find(item => item.axis === 'left');
    const right = series.find(item => item.axis === 'right');
    const alt = series.find(item => item.axis === 'alt');
    return (
        <div data-dual-axis={dual ? 'true' : 'false'} data-chart-label={label}>
            <ul aria-label="Chart series" className="mb-2 flex flex-wrap gap-4 text-xs">
                {series.map(item => (
                    <li key={item.id} data-series-id={item.id} data-stroke={item.color} className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                        <span style={{ color: item.color }}>{seriesLegend(item)}</span>
                    </li>
                ))}
            </ul>
            <div ref={frame} className="h-56 w-full min-w-0" role="img" aria-label={label}>
                {width > 0 ? (
                    <LineChart width={width} height={224} data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} stroke="var(--muted-foreground)" fontSize={11} minTickGap={28} />
                        {left ? <YAxis yAxisId="left" stroke={left.color} fontSize={11} width={40} allowDecimals={left.id === 'position'} /> : null}
                        {right ? <YAxis yAxisId="right" orientation="right" stroke={right.color} fontSize={11} width={44} /> : null}
                        {alt ? <YAxis yAxisId="alt" orientation="right" hide /> : null}
                        <Tooltip
                            contentStyle={{ background: '#141418', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: '#f4f4f5' }}
                        />
                        {series.map(item => (
                            <Line
                                key={item.id}
                                yAxisId={item.axis}
                                type="monotone"
                                dataKey={item.id}
                                name={item.label}
                                stroke={item.color}
                                strokeWidth={2}
                                dot={false}
                                connectNulls={false}
                            />
                        ))}
                    </LineChart>
                ) : null}
            </div>
            <table className="sr-only">
                <caption>{label}</caption>
                <thead>
                    <tr>
                        <th>Date</th>
                        {series.map(item => <th key={item.id}>{item.label}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {points.map(point => (
                        <tr key={point.date}>
                            <td>{point.date}</td>
                            {series.map(item => <td key={item.id}>{pointValue(point, item.id) ?? '—'}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
