'use client';

import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

import { formatDay } from '@/lib/change-log/time';
import type { ChartPoint, Kpi } from '@/lib/change-log/types';
import { KPI_LABEL } from '@/lib/change-log/types';

export function ImpactChart({
    points,
    kpi,
    liveOn,
    controlLabel,
}: {
    points: ChartPoint[];
    kpi: Kpi;
    liveOn: string;
    controlLabel: string;
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
    const data = indexToBaseline(points, liveOn);
    const label = `${KPI_LABEL[kpi]} indexed to the baseline. Marker on ${formatDay(liveOn)}.`;
    return (
        <div>
            <ul className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <li className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-zinc-900" /> Page</li>
                <li className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-zinc-400" /> {controlLabel}</li>
                <li className="inline-flex items-center gap-1.5"><span className="h-2 w-0.5 bg-amber-700" /> Live {formatDay(liveOn)}</li>
            </ul>
            <div ref={frame} className="h-56 w-full min-w-0" role="img" aria-label={label}>
                {width > 0 ? (
                    <LineChart width={width} height={224} data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} stroke="var(--muted-foreground)" fontSize={11} minTickGap={28} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} width={36} />
                        <Tooltip
                            contentStyle={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 8, fontSize: 12 }}
                            labelFormatter={value => formatDay(String(value))}
                        />
                        <ReferenceLine x={liveOn} stroke="#b45309" strokeDasharray="3 3" label={{ value: 'Live', fill: '#b45309', fontSize: 11, position: 'insideTopLeft' }} />
                        <Line type="monotone" dataKey="page" name="Page" stroke="#18181b" strokeWidth={2} dot={false} connectNulls={false} />
                        <Line type="monotone" dataKey="control" name={controlLabel} stroke="#a1a1aa" strokeWidth={1.5} dot={false} connectNulls={false} />
                    </LineChart>
                ) : (
                    <div className="h-full animate-pulse rounded-md bg-muted" />
                )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">100 is the average before the change. Marker on {formatDay(liveOn)}. Days after the final date are left off, not drawn as zero.</p>
        </div>
    );
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    return total === 0 ? null : total / values.length;
}

/** Both lines start at 100 so a small page can be read next to a large site. */
function indexToBaseline(points: ChartPoint[], liveOn: string) {
    const pageBase = average(points.flatMap(point => point.date < liveOn && point.page != null ? [point.page] : []));
    const controlBase = average(points.flatMap(point => point.date < liveOn && point.control != null ? [point.control] : []));
    return points.map(point => ({
        date: point.date,
        page: point.page == null || pageBase == null ? null : (point.page / pageBase) * 100,
        control: point.control == null || controlBase == null ? null : (point.control / controlBase) * 100,
    }));
}
