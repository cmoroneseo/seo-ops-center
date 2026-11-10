'use client';

import type { ReactNode } from 'react';
import { TrackQueryButton } from '@/components/keyword-tracking/TrackQueryButton';
import {
    formatCount,
    formatPosition,
    seriesHasValues,
    SOURCE_LABEL,
    type BingDashboard,
    type BingToggles,
    type ChartPoint,
    type ChartSeries,
    type GaToggles,
    type GscToggles,
    type InsightPageRow,
    type InsightQueryRow,
    type KpiCell,
    type SearchSource,
} from '@/lib/search-dashboard/model';
import { DashboardChart } from './DashboardChart';
import { SourceMark, SourceSwitcher } from './marks';

function KpiStrip({ cells }: { cells: KpiCell[] }) {
    return (
        <div data-kpi-strip className="flex overflow-x-auto rounded-xl border border-border bg-card">
            {cells.map(cell => (
                <div key={cell.id} data-kpi={cell.id} className="min-w-[7.5rem] flex-1 border-l border-border px-4 py-3 first:border-l-0" title={cell.title}>
                    <p className="text-xs text-muted-foreground">{cell.label}</p>
                    <p className={`mt-1 text-xl font-semibold tabular-nums ${cell.tone === 'good' ? 'text-green-500' : cell.tone === 'bad' ? 'text-red-500' : 'text-foreground'}`}>{cell.value}</p>
                </div>
            ))}
        </div>
    );
}

function Toggle({
    pressed,
    color,
    label,
    onClick,
    disabled = false,
}: {
    pressed: boolean;
    color: string;
    label: string;
    onClick?: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground disabled:opacity-100"
        >
            <span className="h-3.5 w-3.5 rounded-[3px] border border-border" style={pressed ? { background: color, borderColor: color } : undefined} />
            {label}
        </button>
    );
}

function Lockup({ source, series }: { source: SearchSource; series: ChartSeries[] }) {
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <SourceMark source={source} muted={false} />
            {series.map(item => (
                <span key={item.id} className="text-sm font-semibold" style={{ color: item.color }}>{item.label}</span>
            ))}
            <span className="text-sm text-muted-foreground">{SOURCE_LABEL[source]}</span>
        </div>
    );
}

function Gap({ label, title, action }: { label: string; title?: string | null; action?: ReactNode }) {
    return (
        <div role="status" className="rounded-xl border border-border bg-card p-6" title={title ?? undefined}>
            <p className="text-sm text-foreground">{label}</p>
            {title ? <p className="mt-1 text-xs text-muted-foreground">{title}</p> : null}
            {action ? <div className="mt-4">{action}</div> : null}
        </div>
    );
}

function ConnectButton({ label, onClick }: { label: string; onClick: () => void }) {
    return <button type="button" className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={onClick}>{label}</button>;
}

function InsightTabs({ section, onSection, label }: { section: 'queries' | 'pages'; onSection: (section: 'queries' | 'pages') => void; label: string }) {
    return (
        <div role="tablist" aria-label={label} className="flex gap-1">
            {(['queries', 'pages'] as const).map(id => (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={section === id}
                    className={`rounded-full border px-3 py-1 text-xs ${section === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                    onClick={() => onSection(id)}
                >
                    {id === 'queries' ? 'Queries' : 'Pages'}
                </button>
            ))}
        </div>
    );
}

export function SearchDashboardView(props: {
    clientName: string;
    clientId: string;
    organizationId: string;
    sources: SearchSource[];
    source: SearchSource | null;
    onSource: (source: SearchSource) => void;
    windowLabel: string;
    loading: boolean;
    showTrack: boolean;
    gscConnected: boolean;
    gscError: string;
    gscKpis: KpiCell[];
    gscPoints: ChartPoint[];
    gscSeries: ChartSeries[];
    gscToggles: GscToggles;
    onGscToggle: (key: keyof GscToggles) => void;
    queries: InsightQueryRow[];
    pages: InsightPageRow[];
    section: 'queries' | 'pages';
    onSection: (section: 'queries' | 'pages') => void;
    tableError: string;
    hiddenQueries: number;
    hiddenPages: number;
    gaConnected: boolean;
    gaError: string;
    gaKpis: KpiCell[];
    gaPoints: ChartPoint[];
    gaSeries: ChartSeries[];
    gaToggles: GaToggles;
    onGaToggle: (key: keyof GaToggles) => void;
    bingEnabled: boolean;
    bing: BingDashboard | null;
    bingToggles: BingToggles;
    onBingToggle: (key: keyof BingToggles) => void;
    bingSeries: ChartSeries[];
    onConnections: () => void;
    embedded?: boolean;
}) {
    const source = props.source;
    return (
        <section className="min-w-0 space-y-4" aria-label="Search" data-search-dashboard="" aria-busy={props.loading}>
            <header>
                {props.embedded ? null : (
                    <>
                        <h2 className="text-[22px] font-bold text-foreground">Search</h2>
                        <p className="mt-1 text-[13px] text-muted-foreground">Daily SEO status and insights across connected sources</p>
                    </>
                )}
                <div className={props.embedded ? 'flex flex-wrap gap-2' : 'mt-3 flex flex-wrap gap-2'}>
                    <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">All locations · All devices</span>
                    <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">locked</span>
                    <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{props.windowLabel}</span>
                </div>
            </header>
            <SourceSwitcher sources={props.sources} source={source} onSource={props.onSource} />
            <div role="tabpanel" id="search-source-panel" className="min-w-0 space-y-4">
                {props.loading ? <div className="h-28 animate-pulse rounded-xl border border-border bg-card" aria-hidden="true" /> : null}
                {!props.loading && source == null ? (
                    <Gap
                        label={`Connect Search Console or Google Analytics to see daily search status for ${props.clientName}.`}
                        action={<ConnectButton label="Manage connections" onClick={props.onConnections} />}
                    />
                ) : null}
                {!props.loading && source === 'gsc' ? (
                    <GscBody {...props} />
                ) : null}
                {!props.loading && source === 'ga' ? (
                    <GaBody {...props} />
                ) : null}
                {!props.loading && source === 'bing' && props.bingEnabled ? (
                    <BingBody {...props} />
                ) : null}
            </div>
        </section>
    );
}

function GscBody(props: {
    clientName: string;
    clientId: string;
    organizationId: string;
    gscConnected: boolean;
    gscError: string;
    gscKpis: KpiCell[];
    gscPoints: ChartPoint[];
    gscSeries: ChartSeries[];
    gscToggles: GscToggles;
    onGscToggle: (key: keyof GscToggles) => void;
    queries: InsightQueryRow[];
    pages: InsightPageRow[];
    section: 'queries' | 'pages';
    onSection: (section: 'queries' | 'pages') => void;
    tableError: string;
    hiddenQueries: number;
    hiddenPages: number;
    showTrack: boolean;
    onConnections: () => void;
}) {
    if (!props.gscConnected) {
        return <Gap label="Search Console isn’t connected." action={<ConnectButton label="Connect Search Console" onClick={props.onConnections} />} />;
    }
    if (props.gscError) return <Gap label={props.gscError} />;
    const plotted = seriesHasValues(props.gscPoints, props.gscSeries);
    return (
        <>
            <KpiStrip cells={props.gscKpis} />
            <div className="rounded-xl border border-border bg-card p-4">
                <Lockup source="gsc" series={props.gscSeries} />
                <div className="mt-3 flex flex-wrap gap-4">
                    <Toggle pressed={props.gscToggles.clicks} color="var(--chart-1)" label="Clicks" onClick={() => props.onGscToggle('clicks')} />
                    <Toggle pressed={props.gscToggles.impressions} color="var(--chart-4)" label="Impressions" onClick={() => props.onGscToggle('impressions')} />
                    <Toggle pressed={props.gscToggles.position} color="var(--chart-3)" label="Avg position" onClick={() => props.onGscToggle('position')} />
                </div>
                <div className="mt-4">
                    {plotted ? <DashboardChart points={props.gscPoints} series={props.gscSeries} label="Search Console daily series" /> : <p className="text-sm text-muted-foreground">No final days in this window.</p>}
                </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-foreground">Search Insights</h3>
                    <InsightTabs section={props.section} onSection={props.onSection} label="Search Insights" />
                </div>
                {props.tableError ? <p role="alert" className="mt-4 text-sm text-destructive">{props.tableError}</p> : null}
                {props.section === 'queries' ? (
                    <InsightTable
                        label="Queries"
                        head={['Query', 'Top page', 'Pos', 'Clicks', 'Impr.', ...(props.showTrack ? ['Action'] : [])]}
                        empty="No queries in this window."
                        hidden={props.hiddenQueries}
                    >
                        {props.queries.map(row => (
                            <tr key={row.query} className="border-b border-border">
                                <th scope="row" className="px-3 py-2 font-medium">{row.query}</th>
                                <td className="px-3 py-2 text-muted-foreground">{row.topPage}</td>
                                <td className="px-3 py-2 font-semibold tabular-nums">{formatPosition(row.position)}</td>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.clicks, 1000)}</td>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.impressions, 1000)}</td>
                                {props.showTrack ? <td className="px-3 py-2 text-right"><TrackQueryButton organizationId={props.organizationId} clientId={props.clientId} query={row.query} /></td> : null}
                            </tr>
                        ))}
                    </InsightTable>
                ) : (
                    <InsightTable label="Pages" head={['Page', 'Pos', 'Clicks', 'Impr.']} empty="No pages in this window." hidden={props.hiddenPages}>
                        {props.pages.map(row => (
                            <tr key={row.page} className="border-b border-border">
                                <th scope="row" className="px-3 py-2 font-medium">{row.page}</th>
                                <td className="px-3 py-2 font-semibold tabular-nums">{formatPosition(row.position)}</td>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.clicks, 1000)}</td>
                                <td className="px-3 py-2 tabular-nums">{formatCount(row.impressions, 1000)}</td>
                            </tr>
                        ))}
                    </InsightTable>
                )}
            </div>
        </>
    );
}

function GaBody(props: {
    clientName: string;
    gaConnected: boolean;
    gaError: string;
    gaKpis: KpiCell[];
    gaPoints: ChartPoint[];
    gaSeries: ChartSeries[];
    gaToggles: GaToggles;
    onGaToggle: (key: keyof GaToggles) => void;
    onConnections: () => void;
}) {
    if (!props.gaConnected) {
        return <Gap label={`Google Analytics isn’t connected for ${props.clientName}.`} action={<ConnectButton label="Connect Google Analytics" onClick={props.onConnections} />} />;
    }
    if (props.gaError) return <Gap label={props.gaError} />;
    const plotted = seriesHasValues(props.gaPoints, props.gaSeries);
    const organic = props.gaSeries.find(item => item.id === 'organicSessions');
    const sessions = props.gaSeries.find(item => item.id === 'sessions');
    const events = props.gaSeries.find(item => item.id === 'keyEvents');
    return (
        <>
            <KpiStrip cells={props.gaKpis} />
            <div className="rounded-xl border border-border bg-card p-4">
                <Lockup source="ga" series={props.gaSeries} />
                <div className="mt-3 flex flex-wrap gap-4">
                    <Toggle pressed color={organic?.color ?? 'var(--chart-1)'} label="Organic sessions" disabled />
                    <Toggle pressed={props.gaToggles.sessions} color={sessions?.color ?? 'var(--chart-3)'} label="Sessions" onClick={() => props.onGaToggle('sessions')} />
                    <Toggle pressed={props.gaToggles.keyEvents} color={events?.color ?? '#34d399'} label="Key events" onClick={() => props.onGaToggle('keyEvents')} />
                </div>
                <div className="mt-4">
                    {plotted ? <DashboardChart points={props.gaPoints} series={props.gaSeries} label="Google Analytics daily series" /> : <p className="text-sm text-muted-foreground">No final days in this window.</p>}
                </div>
            </div>
        </>
    );
}

function BingBody(props: {
    bing: BingDashboard | null;
    bingToggles: BingToggles;
    onBingToggle: (key: keyof BingToggles) => void;
    bingSeries: ChartSeries[];
    section: 'queries' | 'pages';
    onSection: (section: 'queries' | 'pages') => void;
    onConnections: () => void;
}) {
    const bing = props.bing;
    if (!bing || bing.gap) {
        const label = bing?.gap?.label ?? 'Bing: not connected';
        const connect = label === 'Bing: not connected';
        return (
            <div role="status" className="rounded-xl border border-border bg-card px-6 py-16 text-center">
                {connect ? <div className="mb-3 flex justify-center"><SourceMark source="bing" muted={false} /></div> : null}
                <p className="text-sm font-semibold text-foreground">{label}</p>
                {connect ? (
                    <button type="button" className="mt-2 max-w-md text-sm text-muted-foreground" onClick={props.onConnections}>
                        Connect Bing Webmaster for this client to see clicks, impressions, and weekly queries.
                    </button>
                ) : bing?.gap?.title ? <p className="mt-2 text-sm text-muted-foreground">{bing.gap.title}</p> : null}
            </div>
        );
    }
    const plotted = seriesHasValues(bing.points, props.bingSeries);
    const rows = props.section === 'queries' ? bing.queries : bing.pages;
    const note = props.section === 'queries' ? bing.queriesNote : bing.pagesNote;
    const hidden = props.section === 'queries' ? bing.hiddenQueries : bing.hiddenPages;
    return (
        <>
            <KpiStrip cells={bing.kpis} />
            {bing.syncWarning ? <p className="text-xs text-muted-foreground">{bing.syncWarning}</p> : null}
            <div className="rounded-xl border border-border bg-card p-4">
                <Lockup source="bing" series={props.bingSeries} />
                <div className="mt-3 flex flex-wrap gap-4">
                    <Toggle pressed={props.bingToggles.clicks} color="#2dd4bf" label="Clicks" onClick={() => props.onBingToggle('clicks')} />
                    <Toggle pressed={props.bingToggles.impressions} color="#a78bfa" label="Impressions" onClick={() => props.onBingToggle('impressions')} />
                </div>
                <div className="mt-4">
                    {plotted ? <DashboardChart points={bing.points} series={props.bingSeries} label="Bing Webmaster daily clicks and impressions" /> : <p className="text-sm text-muted-foreground">No Bing traffic days in this window.</p>}
                </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-foreground">Bing queries and pages</h3>
                    <div className="flex items-center gap-2">
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">weekly</span>
                        <InsightTabs section={props.section} onSection={props.onSection} label="Bing queries and pages" />
                    </div>
                </div>
                <InsightTable
                    label={props.section === 'queries' ? 'Bing queries' : 'Bing pages'}
                    head={[props.section === 'queries' ? 'Query' : 'Page', 'Clicks', 'Impr.', 'Pos']}
                    empty={note ?? 'No rows in this window.'}
                    hidden={hidden}
                    note={rows.length > 0 ? note : null}
                >
                    {rows.map(row => (
                        <tr key={row.label} className="border-b border-border">
                            <th scope="row" className="px-3 py-2 font-medium">{row.label}</th>
                            <td className="px-3 py-2 tabular-nums">{formatCount(row.clicks, 1000)}</td>
                            <td className="px-3 py-2 tabular-nums">{formatCount(row.impressions, 1000)}</td>
                            <td className="px-3 py-2 tabular-nums" title="Avg impression position">{formatPosition(row.position)}</td>
                        </tr>
                    ))}
                </InsightTable>
            </div>
        </>
    );
}

function InsightTable({
    label,
    head,
    empty,
    hidden,
    note,
    children,
}: {
    label: string;
    head: string[];
    empty: string;
    hidden: number;
    note?: string | null;
    children: ReactNode;
}) {
    const rows = Array.isArray(children) ? children : [children];
    const present = rows.some(Boolean);
    return (
        <div className="mt-4">
            {present ? (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] border-collapse text-left text-sm" aria-label={label}>
                        <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground">
                                {head.map(cell => <th key={cell} scope="col" className="px-3 py-2 font-medium">{cell}</th>)}
                            </tr>
                        </thead>
                        <tbody>{children}</tbody>
                    </table>
                </div>
            ) : <p className="text-sm text-muted-foreground">{empty}</p>}
            {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
            {hidden > 0 ? <p className="mt-2 text-xs text-muted-foreground">Showing the first rows. {hidden} more are hidden.</p> : null}
        </div>
    );
}
