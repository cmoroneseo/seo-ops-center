'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
    CartesianGrid,
    ComposedChart,
    Line,
    LineChart,
    ReferenceArea,
    ReferenceLine,
    Scatter,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import {
    ALIGNED_NOTE,
    CHART_METRICS,
    CHART_METRIC_LABEL,
    LAG_LABEL,
    buildDailyChart,
    buildSideBySide,
    chartDomain,
    dailyChartTitle,
    overlayChartTitle,
    dayTime,
    indexToBaseline,
    lagWindow,
    measuredDaysFromSeries,
    type ChartMarker,
    type ChartMetric,
} from '@/lib/change-log/chart';
import { chartCaption } from '@/lib/change-log/results';
import { formatDay } from '@/lib/change-log/time';
import type { ChartPoint, Kpi } from '@/lib/change-log/types';
import { cn } from '@/lib/utils';

const PAGE = '#18181b';
const BEFORE = '#71717a';
const MUTED = '#a1a1aa';
const LIVE = '#b45309';
const GRID = 'var(--border)';
const TICK = 'var(--muted-foreground)';

type ChartTab = 'daily' | 'aligned' | 'indexed';

const TABS: Array<{ id: ChartTab; label: string }> = [
    { id: 'daily', label: 'Timeline' },
    { id: 'aligned', label: 'Overlay' },
    { id: 'indexed', label: 'Compared with the rest of the site' },
];

export function ImpactChart({
    points,
    kpi,
    liveOn,
    finalThrough,
    controlLabel,
    lowData,
    markers,
    seriesName = 'This page',
    subject = 'page',
}: {
    points: ChartPoint[];
    kpi: Kpi;
    liveOn: string;
    finalThrough: string;
    controlLabel: string;
    lowData: boolean;
    markers: ChartMarker[];
    /** Line name. A group test says "This group". */
    seriesName?: string;
    subject?: 'page' | 'group';
}) {
    const [tab, setTab] = useState<ChartTab>('daily');
    const [metric, setMetric] = useState<ChartMetric>(chartMetric(kpi));
    const days = measuredDaysFromSeries(points);
    const daily = buildDailyChart({ metric, liveOn, finalThrough, days, lowData, markers });
    const aligned = buildSideBySide({ metric, liveOn, finalThrough, days, lowData });
    const indexed = indexToBaseline(points.map(point => ({
        date: point.date,
        page: point.preliminary ? null : pageValue(point, metric),
        control: point.preliminary ? null : controlValue(point, metric),
    })), liveOn);
    const caption = indexed.hasControl ? chartCaption(controlLabel, subject) : null;
    const title = tab === 'daily'
        ? daily.title
        : tab === 'aligned'
            ? overlayChartTitle(metric, aligned.weekly)
            : dailyChartTitle(metric, false).replace(', day by day', '');

    function onTabKey(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const index = TABS.findIndex(item => item.id === tab);
        const next = event.key === 'ArrowRight'
            ? (index + 1) % TABS.length
            : (index - 1 + TABS.length) % TABS.length;
        setTab(TABS[next].id);
    }

    return (
        <div data-chart-tab={tab} data-chart-metric={metric} data-weekly={daily.weekly ? 'true' : 'false'} data-reversed={daily.reversed ? 'true' : 'false'}>
            <div className="change-log-no-print mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Chart metric">
                {CHART_METRICS.map(item => (
                    <button
                        key={item}
                        type="button"
                        role="radio"
                        aria-checked={metric === item}
                        data-chart-metric-option={item}
                        className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset',
                            metric === item ? 'bg-zinc-900 text-white ring-zinc-900' : 'bg-card text-muted-foreground ring-border',
                        )}
                        onClick={() => setMetric(item)}
                    >
                        {CHART_METRIC_LABEL[item]}
                    </button>
                ))}
            </div>
            <div className="change-log-no-print mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Chart view" onKeyDown={onTabKey}>
                <div className="inline-flex rounded-md border border-border p-0.5" role="presentation">
                    {TABS.filter(item => item.id !== 'indexed').map(item => (
                        <ChartTabButton key={item.id} item={item} selected={tab === item.id} onSelect={setTab} segmented />
                    ))}
                </div>
                {TABS.filter(item => item.id === 'indexed').map(item => (
                    <ChartTabButton key={item.id} item={item} selected={tab === item.id} onSelect={setTab} />
                ))}
            </div>
            <h3 className="text-sm font-medium">{title}</h3>
            {tab === 'daily' && (
                <div role="tabpanel" id="change-chart-panel-daily" aria-labelledby="change-chart-tab-daily" data-live-marker="true" className="mt-3">
                    <DailyView model={daily} metric={metric} seriesName={seriesName} />
                </div>
            )}
            {tab === 'aligned' && (
                <div role="tabpanel" id="change-chart-panel-aligned" aria-labelledby="change-chart-tab-aligned" data-live-marker="false" className="mt-3">
                    <p className="mb-3 text-xs text-muted-foreground" data-chart-note="aligned">{aligned.note || ALIGNED_NOTE}</p>
                    <Legend items={[
                        { label: 'Before', color: BEFORE, dashed: true },
                        { label: 'After', color: PAGE },
                    ]} />
                    <ChartFrame label={aligned.note}>
                        {width => (
                            <LineChart width={width} height={224} data={aligned.points} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={GRID} vertical={false} />
                                <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} stroke={TICK} fontSize={11} tickFormatter={value => `${aligned.weekly ? 'Week' : 'Day'} ${value}`} />
                                <YAxis stroke={TICK} fontSize={11} width={48} reversed={aligned.reversed} tickFormatter={value => formatMetric(metric, Number(value))} />
                                <Tooltip content={<AlignedTip metric={metric} weekly={aligned.weekly} />} />
                                <Line type="linear" dataKey="before" name="Before" stroke={BEFORE} strokeDasharray="6 4" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                                <Line type="linear" dataKey="after" name="After" stroke={PAGE} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                            </LineChart>
                        )}
                    </ChartFrame>
                    {aligned.reversedNote && <p className="mt-2 text-xs text-muted-foreground">{aligned.reversedNote}</p>}
                </div>
            )}
            {tab === 'indexed' && (
                <div role="tabpanel" id="change-chart-panel-indexed" aria-labelledby="change-chart-tab-indexed" data-live-marker="true" className="mt-3">
                    {caption && <p className="mb-3 text-xs text-muted-foreground" data-chart-caption>{caption}</p>}
                    <IndexedView
                        points={indexed.points}
                        liveOn={liveOn}
                        finalThrough={finalThrough}
                        controlLabel={controlLabel}
                        hasControl={indexed.hasControl}
                        seriesName={seriesName}
                        caption={caption ?? 'Compared with the rest of the site.'}
                    />
                </div>
            )}
        </div>
    );
}

function ChartTabButton({
    item,
    selected,
    onSelect,
    segmented = false,
}: {
    item: { id: ChartTab; label: string };
    selected: boolean;
    onSelect: (id: ChartTab) => void;
    segmented?: boolean;
}) {
    return (
        <button
            type="button"
            role="tab"
            id={`change-chart-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`change-chart-panel-${item.id}`}
            data-chart-tab-option={item.id}
            className={cn(
                'text-sm',
                segmented ? 'rounded px-3 py-1' : 'border-b-2 border-transparent px-3 py-2',
                selected
                    ? segmented
                        ? 'bg-zinc-900 font-medium text-white'
                        : 'border-zinc-900 font-medium text-foreground'
                    : 'text-muted-foreground',
            )}
            onClick={() => onSelect(item.id)}
        >
            {item.label}
        </button>
    );
}

function DailyView({
    model,
    metric,
    seriesName,
}: {
    model: ReturnType<typeof buildDailyChart>;
    metric: ChartMetric;
    seriesName: string;
}) {
    const hasValue = model.points.some(point => point.value != null);
    const legend = [
        { label: seriesName, color: PAGE },
        ...(model.beforeAverage != null ? [{ label: 'Average before', color: MUTED, dashed: true }] : []),
        ...(model.afterAverage != null ? [{ label: 'Average after', color: PAGE, dashed: true }] : []),
        { label: `Went live ${formatDay(model.wentLive)}`, color: LIVE, dashed: true },
        ...(model.lagStart ? [{ label: LAG_LABEL, color: '#e4e4e7', shade: true }] : []),
        ...(model.markers.length > 0 ? [{ label: seriesName === 'This group' ? 'Other changes on these pages' : 'Other changes on this page', color: LIVE, dot: true }] : []),
    ];
    return (
        <>
            {model.weeklyNote && <p className="mb-3 text-sm text-amber-900" data-chart-note="weekly">{model.weeklyNote}</p>}
            <Legend items={legend} />
            {hasValue ? (
                <ChartFrame label={dailyAria(model)}>
                    {width => (
                        <ComposedChart width={width} height={224} data={model.points} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={GRID} vertical={false} />
                            {/* Explicit span. dataMin/dataMax collapses to the went-live line in recharts 3. */}
                            <XAxis
                                dataKey="time"
                                type="number"
                                scale="linear"
                                domain={timeDomain(model.points)}
                                tickFormatter={value => formatDay(isoFromTime(Number(value)))}
                                stroke={TICK}
                                fontSize={11}
                                minTickGap={28}
                            />
                            <YAxis stroke={TICK} fontSize={11} width={48} reversed={model.reversed} tickFormatter={value => formatMetric(metric, Number(value))} />
                            <Tooltip content={<DailyTip metric={metric} seriesName={seriesName} />} />
                            {model.lagStart && model.lagEnd && (
                                <ReferenceArea x1={dayTime(model.lagStart)} x2={dayTime(model.lagEnd)} fill="#f4f4f5" strokeOpacity={0} />
                            )}
                            <ReferenceLine x={model.wentLiveTime} stroke={LIVE} strokeDasharray="3 3" />
                            <Line type="linear" dataKey="beforeAverage" name="Average before" stroke={MUTED} strokeDasharray="4 4" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                            <Line type="linear" dataKey="afterAverage" name="Average after" stroke={PAGE} strokeDasharray="4 4" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                            <Line type="linear" dataKey="value" name={seriesName} stroke={PAGE} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                            {model.markers.length > 0 && (
                                <Scatter data={model.markers} dataKey="value" name="Other change" fill={LIVE} isAnimationActive={false} />
                            )}
                        </ComposedChart>
                    )}
                </ChartFrame>
            ) : (
                <p className="text-sm text-muted-foreground">No saved days for this period yet.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">A gap is a day with no report. A zero is a real zero.</p>
            {model.lagStart && <p className="mt-1 text-xs text-muted-foreground">The shaded days are waiting for Google&apos;s data. They are not zero.</p>}
            {model.reversedNote && <p className="mt-1 text-xs text-muted-foreground">{model.reversedNote}</p>}
        </>
    );
}

function IndexedView({
    points,
    liveOn,
    finalThrough,
    controlLabel,
    hasControl,
    seriesName,
    caption,
}: {
    points: ReturnType<typeof indexToBaseline>['points'];
    liveOn: string;
    finalThrough: string;
    controlLabel: string;
    hasControl: boolean;
    seriesName: string;
    caption: string;
}) {
    const showControl = hasControl && controlLabel !== 'No comparison';
    const lag = lagWindow(finalThrough, chartDomain(liveOn, finalThrough));
    const legend = [
        { label: seriesName, color: PAGE },
        ...(showControl ? [{ label: controlLabel, color: MUTED }] : []),
        { label: `Went live ${formatDay(liveOn)}`, color: LIVE, dashed: true },
    ];
    return (
        <>
            <Legend items={legend} />
            <ChartFrame label={`${caption} Went live ${formatDay(liveOn)}.`}>
                {width => (
                    <LineChart width={width} height={224} data={points} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis
                            dataKey="time"
                            type="number"
                            scale="linear"
                            domain={timeDomain(points)}
                            tickFormatter={value => formatDay(isoFromTime(Number(value)))}
                            stroke={TICK}
                            fontSize={11}
                            minTickGap={28}
                        />
                        <YAxis stroke={TICK} fontSize={11} width={40} />
                        <Tooltip content={<IndexedTip showControl={showControl} controlLabel={controlLabel} seriesName={seriesName} />} />
                        {lag && <ReferenceArea x1={dayTime(lag.start)} x2={dayTime(lag.end)} fill="#f4f4f5" strokeOpacity={0} />}
                        <ReferenceLine x={dayTime(liveOn)} stroke={LIVE} strokeDasharray="3 3" />
                        <Line type="linear" dataKey="page" name={seriesName} stroke={PAGE} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                        {showControl && (
                            <Line type="linear" dataKey="control" name={controlLabel} stroke={MUTED} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                        )}
                    </LineChart>
                )}
            </ChartFrame>
            <p className="mt-2 text-xs text-muted-foreground">Days still waiting on Google are left off, not drawn as zero.</p>
        </>
    );
}

function ChartFrame({ label, children }: { label: string; children: (width: number) => ReactNode }) {
    const frame = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const node = frame.current;
        if (!node) return;
        const measure = () => setWidth(node.clientWidth);
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);
    return (
        <div ref={frame} className="h-56 w-full min-w-0" role="img" aria-label={label}>
            {width > 0 ? children(width) : <div className="h-full animate-pulse rounded-md bg-muted" />}
        </div>
    );
}

function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean; shade?: boolean; dot?: boolean }> }) {
    return (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {items.map(item => (
                <li key={item.label} className="inline-flex items-center gap-1.5">
                    {item.shade ? (
                        <span className="h-2.5 w-4 rounded-sm border border-zinc-200 bg-zinc-100" />
                    ) : item.dot ? (
                        <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                    ) : (
                        <span
                            className={cn('inline-block h-0.5 w-4', item.dashed && 'border-t border-dashed bg-transparent')}
                            style={item.dashed ? { borderColor: item.color } : { background: item.color }}
                        />
                    )}
                    {item.label}
                </li>
            ))}
        </ul>
    );
}

function TipFrame({ children }: { children: ReactNode }) {
    return <div className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800">{children}</div>;
}

function DailyTip({ active, payload, metric, seriesName }: { active?: boolean; payload?: TipRow[]; metric: ChartMetric; seriesName: string }) {
    if (!active || !payload?.length) return null;
    const page = payload.find(item => item.name === seriesName)?.payload;
    const marker = payload.find(item => item.name === 'Other change')?.payload;
    const date = page?.date ?? marker?.date;
    if (!date) return null;
    return (
        <TipFrame>
            <p>{formatDay(date)}</p>
            {page && <p>{page.value == null ? 'Not reported yet' : formatMetric(metric, page.value)}</p>}
            {marker?.title && <p>{marker.title}</p>}
        </TipFrame>
    );
}

function AlignedTip({
    active,
    payload,
    metric,
    weekly,
}: {
    active?: boolean;
    payload?: TipRow[];
    metric: ChartMetric;
    weekly: boolean;
}) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row || row.day == null) return null;
    return (
        <TipFrame>
            <p>{weekly ? `Week ${row.day}` : `Day ${row.day}`}</p>
            <p>Before: {row.before == null ? 'Not reported yet' : formatMetric(metric, row.before)}</p>
            <p>After: {row.after == null ? 'Not reported yet' : formatMetric(metric, row.after)}</p>
        </TipFrame>
    );
}

function IndexedTip({
    active,
    payload,
    showControl,
    controlLabel,
    seriesName,
}: {
    active?: boolean;
    payload?: TipRow[];
    showControl: boolean;
    controlLabel: string;
    seriesName: string;
}) {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row?.date) return null;
    return (
        <TipFrame>
            <p>{formatDay(row.date)}</p>
            <p>{seriesName}: {row.page == null ? 'Not reported yet' : Math.round(row.page)}</p>
            {showControl && <p>{controlLabel}: {row.control == null ? 'Not reported yet' : Math.round(row.control)}</p>}
        </TipFrame>
    );
}

interface TipRow {
    name?: string;
    payload?: {
        date?: string;
        title?: string;
        value?: number | null;
        page?: number | null;
        control?: number | null;
        before?: number | null;
        after?: number | null;
        day?: number;
    };
}

function chartMetric(kpi: Kpi): ChartMetric {
    if (kpi === 'clicks' || kpi === 'impressions' || kpi === 'ctr' || kpi === 'avg_position') return kpi;
    return 'clicks';
}

function pageValue(point: ChartPoint, metric: ChartMetric): number | null {
    if (metric === 'clicks') return point.clicks;
    if (metric === 'impressions') return point.impressions;
    if (metric === 'ctr') return point.ctr;
    return point.position;
}

function controlValue(point: ChartPoint, metric: ChartMetric): number | null {
    if (metric === 'clicks') return point.controlClicks;
    if (metric === 'impressions') return point.controlImpressions;
    if (metric === 'ctr') return point.controlCtr;
    return point.controlPosition;
}

function formatMetric(metric: ChartMetric, value: number): string {
    if (!Number.isFinite(value)) return '';
    if (metric === 'ctr') return `${(value * 100).toFixed(2)}%`;
    if (metric === 'avg_position') return value.toFixed(1);
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded)
        ? new Intl.NumberFormat('en-US').format(rounded)
        : rounded.toFixed(1);
}

function timeDomain(points: readonly { time: number }[]): [number, number] | ['dataMin', 'dataMax'] {
    if (points.length === 0) return ['dataMin', 'dataMax'];
    let min = points[0].time;
    let max = points[0].time;
    for (const point of points) {
        if (point.time < min) min = point.time;
        if (point.time > max) max = point.time;
    }
    return min === max ? [min - 1, max + 1] : [min, max];
}

function isoFromTime(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
}

function dailyAria(model: ReturnType<typeof buildDailyChart>): string {
    const parts = [model.title, `Went live ${formatDay(model.wentLive)}`];
    if (model.weeklyNote) parts.push(model.weeklyNote.replace(/\.$/, ''));
    if (model.reversedNote) parts.push(model.reversedNote.replace(/\.$/, ''));
    if (model.lagStart) parts.push("The shaded days are waiting for Google's data");
    return `${parts.join('. ')}.`;
}
