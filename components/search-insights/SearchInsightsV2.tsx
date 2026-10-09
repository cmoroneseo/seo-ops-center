'use client';

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Receipt } from '@/components/reporting/Receipt';
import type { SearchReportingResponse, SurfaceFilter } from '@/lib/search-reporting/types';
import {
    parseInsightsDeepLink,
    presentInsights,
    type InsightsPresentation,
    type SectionId,
} from '@/lib/search-insights/view';
import { CardSource, DeltaReadout, InsightTable, PanelCard, PositionCell, SurfaceMark, useSurfaceColors } from './bits';
import { SurfaceCharts } from './SurfaceCharts';

const SURFACES: { id: SurfaceFilter; label: string }[] = [
    { id: 'all', label: 'All Search' },
    { id: 'organic', label: 'Organic' },
    { id: 'map', label: 'Map pack' },
];

export function SearchInsightsV2({
    clientId,
    clientName,
    onConnections,
    onSiteInventory,
    evidence,
    fixture,
    example = false,
    initialSection,
}: {
    clientId: string;
    clientName: string;
    onConnections: () => void;
    onSiteInventory?: () => void;
    evidence?: ReactNode;
    fixture?: SearchReportingResponse;
    example?: boolean;
    initialSection?: SectionId;
}) {
    const initial = useMemo(
        () => parseInsightsDeepLink(typeof window === 'undefined' ? '' : window.location.search),
        [],
    );
    const [range, setRange] = useState(initial.range ?? '28d');
    const [section, setSection] = useState<SectionId>(initialSection ?? initial.section ?? 'summary');
    const [surface, setSurface] = useState<SurfaceFilter>('all');
    const [response, setResponse] = useState<SearchReportingResponse | null>(fixture ?? null);
    const [loading, setLoading] = useState(!fixture);
    const [error, setError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (fixture) return;
        const controller = new AbortController();
        const params = new URLSearchParams({ view: 'v2', clientId, range, surface });
        setLoading(true);
        fetch(`/api/integrations/google/gsc/insights?${params}`, { signal: controller.signal })
            .then(async (result) => {
                const body = await result.json().catch(() => ({}));
                if (!result.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Unable to load Search Insights');
                if (!controller.signal.aborted) {
                    setResponse(body as SearchReportingResponse);
                    setError('');
                }
            })
            .catch((reason: unknown) => {
                if (controller.signal.aborted) return;
                setError(reason instanceof Error ? reason.message : 'Unable to load Search Insights');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [clientId, range, surface, reloadKey, fixture]);

    useEffect(() => {
        if (fixture || typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        url.searchParams.set('tab', 'insights');
        url.searchParams.set('range', range);
        if (section === 'summary') url.searchParams.delete('section');
        else url.searchParams.set('section', section);
        window.history.replaceState(null, '', url);
    }, [fixture, range, section]);

    const view = useMemo(
        () => (response ? presentInsights(response, { example, clientId, domain: clientName }) : null),
        [response, example, clientId, clientName],
    );

    return (
        <section className="min-w-0 space-y-4" data-search-insights="v2" aria-label="Search Insights">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-widest text-primary">Search performance</p>
                    <h2 className="mt-1 text-2xl font-semibold text-foreground">Search Insights</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{clientName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {example ? (
                        <span className="rounded-full border border-border px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground">EXAMPLE</span>
                    ) : null}
                    {onSiteInventory ? (
                        <button type="button" onClick={onSiteInventory} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                            <ShieldCheck className="h-4 w-4" aria-hidden="true" />Site inventory
                        </button>
                    ) : null}
                </div>
            </header>

            {error ? (
                <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-4">
                    <p>{error}</p>
                    <button type="button" className="mt-3 text-sm text-primary underline" onClick={() => setReloadKey(value => value + 1)}>Retry</button>
                </div>
            ) : null}
            {loading && !view ? <p role="status" className="rounded-xl border border-border bg-card p-8 text-muted-foreground">Loading Search Insights…</p> : null}
            {view && !view.connected ? (
                <div className="rounded-xl border border-border bg-card p-6" role="status">
                    <p className="max-w-2xl text-sm text-foreground">{view.connect?.body}</p>
                    <button type="button" className="mt-4 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={onConnections}>
                        {view.connect?.action}
                    </button>
                </div>
            ) : null}
            {view?.connected ? (
                <ConnectedView
                    view={view}
                    section={section}
                    onSection={setSection}
                    surface={surface}
                    onSurface={setSurface}
                    range={range}
                    monthValue={response?.range?.preset === 'month' ? response.range.key : (response?.range?.end.slice(0, 7) ?? '')}
                    onRange={setRange}
                    onRetry={() => setReloadKey(value => value + 1)}
                    onConnections={onConnections}
                    evidence={evidence}
                />
            ) : null}
        </section>
    );
}

function ConnectedView({
    view,
    section,
    onSection,
    surface,
    onSurface,
    range,
    monthValue,
    onRange,
    onRetry,
    onConnections,
    evidence,
}: {
    view: InsightsPresentation;
    section: SectionId;
    onSection: (section: SectionId) => void;
    surface: SurfaceFilter;
    onSurface: (surface: SurfaceFilter) => void;
    range: string;
    monthValue: string;
    onRange: (range: string) => void;
    onRetry: () => void;
    onConnections: () => void;
    evidence?: ReactNode;
}) {
    const colors = useSurfaceColors();
    const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
        const ids = view.sections.map(item => item.id);
        const current = ids.indexOf(section);
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : event.key === 'ArrowRight' ? Math.min(ids.length - 1, current + 1) : Math.max(0, current - 1);
        onSection(ids[next]);
        document.getElementById(`insights-tab-${ids[next]}`)?.focus();
    };

    return (
        <>
            <ul className="flex gap-2 overflow-x-auto" aria-label="Source health">
                {view.health.map(chip => (
                    <li key={chip.id} className="min-w-36 flex-1 rounded-lg border border-border bg-card px-3 py-2">
                        <p className="text-xs font-medium text-foreground">{chip.id === 'gsc' && chip.detail.startsWith('synced') ? '● ' : ''}{chip.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{chip.detail}</p>
                    </li>
                ))}
            </ul>
            {view.banner ? (
                <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-card px-4 py-3 text-sm text-foreground" data-banner={view.banner.id}>
                    {view.banner.id === 'partial' ? <span aria-hidden="true" style={{ color: 'var(--reporting-info)' }}>ⓘ</span> : null}
                    <p className="min-w-0 flex-1">{view.banner.body}</p>
                    {view.banner.action === 'retry' ? (
                        <button type="button" className="text-sm text-primary underline" onClick={onRetry}>{view.banner.actionLabel}</button>
                    ) : null}
                    {view.banner.action === 'property' ? (
                        <button type="button" className="text-sm text-primary underline" onClick={onConnections}>{view.banner.actionLabel}</button>
                    ) : null}
                </div>
            ) : null}
            {view.grainNotes.length > 0 ? (
                <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="Grains not collected yet">
                    {view.grainNotes.map(note => <li key={note} className="rounded-full border border-border px-2 py-1">{note}</li>)}
                </ul>
            ) : null}
            <div className="sticky top-0 z-20 border-b border-border bg-background/95 py-2 backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div role="tablist" aria-label="Search Insights sections" className="flex flex-wrap gap-1" onKeyDown={onTabKey}>
                        {view.sections.map(item => (
                            <button
                                key={item.id}
                                id={`insights-tab-${item.id}`}
                                type="button"
                                role="tab"
                                aria-selected={section === item.id}
                                aria-controls={`insights-panel-${item.id}`}
                                tabIndex={section === item.id ? 0 : -1}
                                className={`rounded-md px-3 py-1.5 text-sm ${section === item.id ? 'bg-primary/10 text-foreground' : 'text-muted-foreground'}`}
                                onClick={() => onSection(item.id)}
                            >
                                {item.label}
                                {item.badge != null ? <span className="ml-1 rounded-full bg-muted px-1.5 text-xs text-foreground">{item.badge}</span> : null}
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{view.rangeLabel}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div role="group" aria-label="Surface" className="flex rounded-lg border border-border p-1">
                        {SURFACES.map(item => (
                            <button key={item.id} type="button" aria-pressed={surface === item.id} className={`rounded-md px-2 py-1 text-xs ${surface === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} onClick={() => onSurface(item.id)}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <button type="button" aria-pressed={range === '28d'} className={`rounded-lg border border-border px-2 py-1 text-xs ${range === '28d' ? 'text-foreground' : 'text-muted-foreground'}`} onClick={() => onRange('28d')}>
                        28 final days
                    </button>
                    <label className="text-xs text-muted-foreground">
                        <span className="sr-only">Calendar month</span>
                        <input type="month" value={monthValue} className="rounded-md border border-border bg-card px-2 py-1 text-foreground" onChange={event => { if (event.target.value) onRange(event.target.value); }} />
                    </label>
                    {view.priorLabel ? (
                        view.priorReason ? (
                            <p className="text-xs text-muted-foreground"><s>{view.priorLabel}</s> {view.priorReason}</p>
                        ) : (
                            <p className="text-xs text-muted-foreground">vs {view.priorLabel}</p>
                        )
                    ) : null}
                    <p className="text-xs text-muted-foreground">{view.positionLegend}</p>
                </div>
            </div>
            {view.preliminaryLegend ? <p className="text-xs text-amber-700 dark:text-amber-400">{view.preliminaryLegend}</p> : null}
            {view.staleAsOf ? <p className="text-xs text-amber-700 dark:text-amber-400">{view.staleAsOf}</p> : null}

            <div role="tabpanel" id={`insights-panel-${section}`} aria-labelledby={`insights-tab-${section}`} className="min-w-0 space-y-4">
                {section === 'summary' ? <Summary view={view} /> : null}
                {section === 'queries' ? <Queries view={view} colors={colors} evidence={evidence} /> : null}
                {section === 'cities' ? <Cities view={view} /> : null}
                {section === 'movers' ? <Movers view={view} /> : null}
                {section === 'pages' ? <Pages view={view} /> : null}
                {section === 'tracker' ? <Tracker view={view} /> : null}
            </div>
        </>
    );
}

function Summary({ view }: { view: InsightsPresentation }) {
    return (
        <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {view.kpis.map(kpi => (
                    <article key={kpi.id} className="rounded-xl border border-border bg-card p-4">
                        <p className="text-sm text-muted-foreground">{kpi.label}</p>
                        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
                            {kpi.receipt ? <Receipt input={kpi.receipt} /> : kpi.splits.length > 0 ? null : kpi.value}
                        </p>
                        {kpi.splits.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                                {kpi.splits.map(split => (
                                    <li key={split.label} className="flex items-center justify-between gap-2 text-sm">
                                        <SurfaceMark name={split.label} />
                                        <span className="font-semibold tabular-nums" style={{ color: split.colorToken === 'map' ? 'var(--map)' : 'var(--chart-1)' }}>{split.value}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <DeltaReadout delta={kpi.delta} />
                            <span className="text-xs text-muted-foreground">{kpi.hint}</span>
                        </div>
                    </article>
                ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(16rem,0.8fr)]">
                <PanelCard title="Daily search visibility" extra={<CardSource source={view.source} />}>
                    {view.chart ? <SurfaceCharts chart={view.chart} /> : (
                        <p className="text-sm text-muted-foreground">{view.banner?.body ?? 'No saved days in this window.'}</p>
                    )}
                </PanelCard>
                {view.tracker?.verdict ? (
                    <PanelCard title="Tracker anomaly" extra={<span className="text-xs text-muted-foreground">Staff only</span>}>
                        <p className="text-sm font-medium text-green-600">{view.tracker.verdict}</p>
                        <ul className="mt-3 space-y-2">
                            {view.tracker.rows.slice(0, 4).map(row => (
                                <li key={row.query} className="flex items-center justify-between gap-2 text-sm">
                                    <span className="truncate text-foreground">{row.query}</span>
                                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{row.status}</span>
                                </li>
                            ))}
                        </ul>
                    </PanelCard>
                ) : null}
            </div>
        </>
    );
}

function Queries({
    view,
    colors,
    evidence,
}: {
    view: InsightsPresentation;
    colors: { organic: string; map: string };
    evidence?: ReactNode;
}) {
    return (
        <>
            <PanelCard title="Position bands" extra={<CardSource source={view.queries?.source ?? null} />}>
                <div className="space-y-5">
                    {view.queries?.surfaces.map(item => (
                        <div key={item.id}>
                            <p className="mb-2 text-sm font-medium">
                                <SurfaceMark name={item.label} />
                            </p>
                            <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                {item.bands.map(band => (
                                    <div key={band.id} style={{ width: `${Math.max(band.share * 100, band.queries > 0 ? 2 : 0)}%`, background: item.id === 'organic' ? colors.organic : colors.map, opacity: 0.45 + band.share * 0.55 }} />
                                ))}
                            </div>
                            <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                                {item.bands.map(band => (
                                    <li key={band.id}>
                                        <p className="text-xs text-muted-foreground">{band.label}</p>
                                        <p className="font-semibold tabular-nums">{band.queries}</p>
                                        <p className="text-xs text-muted-foreground">{band.impressions.toLocaleString('en-US')} impressions</p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </PanelCard>
            {evidence}
        </>
    );
}

function Cities({ view }: { view: InsightsPresentation }) {
    return (
        <PanelCard title="Cities" extra={<CardSource source={view.cities?.source ?? null} />}>
            <InsightTable label="Cities" head={['City', 'Surface', 'Impressions', 'Note']}>
                {view.cities?.rows.map(row => (
                    <tr key={row.key} className="reporting-row border-b border-border">
                        <th scope="row" className="px-3 py-2 font-medium">{row.cells[0]}</th>
                        <td className="px-3 py-2"><SurfaceMark name={row.cells[1]} /></td>
                        <td className="px-3 py-2 tabular-nums" style={row.cells[1] === 'Map pack' ? { color: 'var(--map)' } : undefined}>{row.receipt ? <Receipt input={row.receipt} /> : row.cells[2]}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.cells[3]}</td>
                    </tr>
                ))}
            </InsightTable>
            {view.cities?.hidden ? <p className="mt-2 text-xs text-muted-foreground">Showing the first rows. {view.cities.hidden} more are hidden so this view stays readable.</p> : null}
        </PanelCard>
    );
}

function Movers({ view }: { view: InsightsPresentation }) {
    return (
        <PanelCard title="Movers" extra={<CardSource source={view.movers?.source ?? null} />}>
            {view.movers?.distorted ? <p className="mb-3 text-sm text-muted-foreground">Changes are hidden because the prior window is distorted.</p> : null}
            <InsightTable label="Movers" head={['Query', 'Surface', 'Impressions', 'Prior impressions', 'Tag']}>
                {view.movers?.rows.map(row => (
                    <tr key={row.key} className="border-b border-border">
                        {row.cells.map((cell, index) => index === 0
                            ? <th key={`${row.key}-label`} scope="row" className="px-3 py-2 font-medium">{cell}</th>
                            : <td key={`${row.key}-${index}`} className="px-3 py-2 text-foreground" style={row.cells[1] === 'Map pack' && index === 2 ? { color: 'var(--map)' } : undefined}>{index === 1 ? <SurfaceMark name={cell} /> : cell}</td>)}
                    </tr>
                ))}
            </InsightTable>
        </PanelCard>
    );
}

function Pages({ view }: { view: InsightsPresentation }) {
    return (
        <PanelCard title="Pages" extra={<CardSource source={view.pages?.source ?? null} />}>
            <InsightTable label="Pages" head={['Page', 'Surface', 'Impressions', 'Clicks', view.positionHeader]}>
                {view.pages?.rows.map(row => (
                    <tr key={row.key} className="reporting-row border-b border-border">
                        <th scope="row" className="px-3 py-2 font-medium">{row.cells[0]}</th>
                        <td className="px-3 py-2"><SurfaceMark name={row.cells[1]} /></td>
                        <td className="px-3 py-2 tabular-nums" style={row.cells[1] === 'Map pack' ? { color: 'var(--map)' } : undefined}>{row.receipt ? <Receipt input={row.receipt} /> : row.cells[2]}</td>
                        <td className="px-3 py-2 tabular-nums">{row.cells[3]}</td>
                        <PositionCell value={row.position} text={row.cells[4]} />
                    </tr>
                ))}
            </InsightTable>
            {view.pages?.hidden ? <p className="mt-2 text-xs text-muted-foreground">{view.pages.hidden} more pages are not listed here.</p> : null}
        </PanelCard>
    );
}

function Tracker({ view }: { view: InsightsPresentation }) {
    const tracker = view.tracker;
    if (!tracker) return null;
    return (
        <div className="space-y-4" data-audience="staff">
            <PanelCard title="Tracker check" extra={<span className="text-xs text-muted-foreground">Staff only</span>}>
                <CardSource source={tracker.source} />
                {tracker.verdict ? <p className="mt-3 text-sm font-medium text-green-600">{tracker.verdict}</p> : null}
                {tracker.empty ? <p className="mt-3 text-sm text-muted-foreground">{tracker.empty}</p> : null}
                {tracker.ahrefsNote ? <p className="mt-2 text-sm text-muted-foreground">{tracker.ahrefsNote}</p> : null}
                {tracker.rows.length > 0 ? (
                    <InsightTable label="Tracker reconciliation" head={['Query', 'Ahrefs', 'Google organic', 'Status']}>
                        {tracker.rows.map(row => (
                            <tr key={row.query} className="border-b border-border">
                                <th scope="row" className="px-3 py-2 font-medium">{row.query}</th>
                                <td className="px-3 py-2 tabular-nums">{row.tracker}</td>
                                <td className="px-3 py-2 tabular-nums">{row.gsc}</td>
                                <td className="px-3 py-2"><span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{row.status}</span></td>
                            </tr>
                        ))}
                    </InsightTable>
                ) : null}
                <p className="mt-3 text-sm text-muted-foreground">DataForSEO · {tracker.dfs}</p>
            </PanelCard>
        </div>
    );
}
